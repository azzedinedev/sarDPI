/**
 * MODULE CARNET VACCINAL — le calendrier est administrable (Administration » Vaccination), les doses
 * sont RATTACHÉES AU DOSSIER PATIENT (`patient_vaccinations.patient_id`) et suivies dans le carnet.
 * ---------------------------------------------------------------------------------------------
 *  - CRUD `vaccinations` : moteur générique (recherche, filtres, pagination, export CSV, archivage)
 *    + contrôle d'unicité (patient, vaccin, n° de dose) + code métier `VAX-000001` alloué sous verrou ;
 *  - `GET  /patients/:id/vaccination`          : le carnet — calendrier, doses, couverture par vaccin,
 *                                                synthèse (retards, pourcentage) calculée par les
 *                                                fonctions pures de `@sardpi/shared` ;
 *  - `POST /patients/:id/vaccination/generate` : matérialise les doses manquantes du calendrier
 *                                                (statut « planifiée », échéance = naissance + âge
 *                                                recommandé) — idempotent, aucune dose existante
 *                                                n'est modifiée ni dupliquée ;
 *  - `GET  /vaccinations/calendar`             : calendrier actif pour les formulaires (libellés
 *                                                traduits, âges, nombre de doses) — évite d'exiger
 *                                                la permission `setting:view` d'un infirmier.
 * Chaque écriture pousse un événement dans l'historique clinique du patient (kind « vaccination »),
 * distinct de l'audit technique, et invalide le cache du carnet.
 */
import { z } from 'zod';
import {
  coverageSummary,
  pickLabel,
  vaccinationCoverage,
  vaccinationDoseUpdateZ,
  vaccinationDoseZ,
  vaccinationPlan,
  type MultiLabel,
  type VaccineCoverage,
  type VaccineScheduleEntry,
} from '@sardpi/shared';
import { route, type Ctx } from '../http/router';
import { registerCrud } from '../http/crud';
import { ApiError, notFound } from '../http/errors';
import { getDb } from '../data';
import { getSection } from '../settings';
import { allocateSuffixed } from '../codes/service';
import { bumpTag, cached } from '../cache';
import { pushHistory } from './history';

/** Calendrier vaccinal courant (réglage « vaccination ») — entrées actives uniquement pour la saisie. */
export async function vaccinationCalendar(): Promise<{ enabled: boolean; schedule: VaccineScheduleEntry[] }> {
  const section = (await getSection('vaccination')) as { enabled?: boolean; schedule?: VaccineScheduleEntry[] };
  const schedule = Array.isArray(section.schedule) ? section.schedule : [];
  return { enabled: section.enabled !== false, schedule };
}

async function scheduleByKey(): Promise<Map<string, VaccineScheduleEntry>> {
  const { schedule } = await vaccinationCalendar();
  return new Map(schedule.filter((e) => e?.key).map((e) => [String(e.key), e]));
}

interface PatientLite {
  id: number;
  code: string;
  fullName: string;
  birthDate: string | null;
}

async function patientOf(id: number): Promise<PatientLite | null> {
  const db = await getDb();
  const row = await db.findOne<Record<string, unknown>>('patients', { id });
  if (!row) return null;
  const first = String(row.first_name ?? '');
  const last = String(row.last_name ?? '');
  return {
    id: Number(row.id),
    code: String(row.code ?? ''),
    fullName: `${last} ${first}`.trim() || String(row.full_name ?? ''),
    birthDate: row.birth_date ? String(row.birth_date).slice(0, 10) : null,
  };
}

/** Doses actives (non archivées) d'un patient — lecture directe, jamais de cache sur le PHI. */
async function dosesOfPatient(patientId: number): Promise<Record<string, unknown>[]> {
  const db = await getDb();
  const rows = await db.find<Record<string, unknown>>('patient_vaccinations', {
    where: [{ field: 'patient_id', op: 'eq', value: patientId }, { field: 'archived_at', op: 'isNull' }],
    orderBy: [['administered_at', 'desc'], ['id', 'desc']],
    limit: 2000,
  });
  return rows;
}

/** Résumé clinique multilingue poussé dans l'historique du patient (jamais de clé brute à l'écran). */
function summaryOf(row: Record<string, unknown>, label: string, doseNo: number): MultiLabel {
  const status = String(row.status ?? 'done');
  const when = row.administered_at ? String(row.administered_at).slice(0, 10) : row.due_at ? String(row.due_at).slice(0, 10) : '';
  const suffix = when ? ` — ${when}` : '';
  return {
    fr: `${label} (dose ${doseNo}) : ${status === 'done' ? 'administré' : status === 'planned' ? 'planifié' : status === 'refused' ? 'refusé' : 'manqué'}${suffix}`,
    ar: `${label} (الجرعة ${doseNo}) : ${status === 'done' ? 'تم التطعيم' : status === 'planned' ? 'مخطط' : status === 'refused' ? 'مرفوض' : 'فائت'}${suffix}`,
    es: `${label} (dosis ${doseNo}) : ${status === 'done' ? 'administrada' : status === 'planned' ? 'planificada' : status === 'refused' ? 'rechazada' : 'faltada'}${suffix}`,
    en: `${label} (dose ${doseNo}) : ${status === 'done' ? 'given' : status === 'planned' ? 'planned' : status === 'refused' ? 'refused' : 'missed'}${suffix}`,
  };
}

export function registerVaccination(): void {
  /* ------------------------------------------------------------------ statistiques (hub admin) */
  // Déclarée AVANT le CRUD : `/vaccinations/stats` et `/vaccinations/:id` ont même nombre de
  // segments, mais le routeur privilégie les chemins sans paramètre — l'ordre reste explicite.
  route({
    method: 'GET',
    path: '/vaccinations/stats',
    perm: ['vaccination', 'view'],
    cacheable: true,
    async handler() {
      const [stats, calendar] = await Promise.all([vaccinationStats(), vaccinationCalendar()]);
      const active = calendar.schedule.filter((e) => e?.key && e.active !== false);
      return {
        ...stats,
        enabled: calendar.enabled,
        scheduleCount: active.length,
        mandatoryCount: active.filter((e) => e.mandatory).length,
        expectedDoses: active.reduce((n, e) => n + Math.max(1, Math.min(10, Number(e.doses ?? 1))), 0),
      };
    },
  });

  /* ------------------------------------------------------------------ calendrier (formulaires) */
  route({
    method: 'GET',
    path: '/vaccinations/calendar',
    perm: ['vaccination', 'view'],
    cacheable: true,
    async handler(ctx: Ctx) {
      const { enabled, schedule } = await vaccinationCalendar();
      const lang = ctx.user?.locale ?? 'fr';
      return {
        enabled,
        schedule: schedule.map((e) => ({
          key: String(e.key),
          label: pickLabel((e.label ?? {}) as MultiLabel, lang),
          labelJson: e.label ?? {},
          ageLabel: String(e.ageLabel ?? ''),
          ageMonths: Number(e.ageMonths ?? 0),
          ageWeeks: Number(e.ageWeeks ?? 0),
          doses: Number(e.doses ?? 1),
          intervalDays: Number(e.intervalDays ?? 0),
          mandatory: Boolean(e.mandatory),
          active: e.active !== false,
        })),
      };
    },
  });

  /* ------------------------------------------------------------------ carnet du patient */
  route({
    method: 'GET',
    path: '/patients/:id/vaccination',
    perm: ['vaccination', 'view'],
    async handler(ctx: Ctx) {
      const patient = await patientOf(Number(ctx.params.id));
      if (!patient) throw notFound();
      const [{ enabled, schedule }, rows] = await Promise.all([vaccinationCalendar(), dosesOfPatient(patient.id)]);
      const lang = ctx.user?.locale ?? 'fr';
      const doses = rows.map((r) => ({
        id: Number(r.id),
        code: String(r.code ?? ''),
        vaccine_key: String(r.vaccine_key),
        dose_no: Number(r.dose_no ?? 1),
        status: String(r.status ?? 'planned'),
        administered_at: r.administered_at ? String(r.administered_at).slice(0, 10) : null,
        due_at: r.due_at ? String(r.due_at).slice(0, 10) : null,
        site: r.site ? String(r.site) : null,
        batch: r.batch ? String(r.batch) : null,
        notes: r.notes ? String(r.notes) : null,
        record_id: r.record_id ? Number(r.record_id) : null,
        practitioner_id: r.practitioner_id ? Number(r.practitioner_id) : null,
        location_id: r.location_id ? Number(r.location_id) : null,
        created_at: r.created_at ?? null,
      }));
      const byKey = await scheduleByKey();
      const coverage: VaccineCoverage[] = vaccinationCoverage(schedule, doses, { birthISO: patient.birthDate });
      return {
        patient,
        enabled,
        summary: coverageSummary(coverage),
        coverage: coverage.map((c) => ({ ...c, label: pickLabel(c.label as MultiLabel, lang), labelJson: c.label })),
        doses,
        /** clés du calendrier — un carnet peut contenir une dose dont le vaccin a été retiré */
        knownKeys: [...byKey.keys()],
      };
    },
  });

  /* ------------------------------------------------------------------ génération du plan */
  route({
    method: 'POST',
    path: '/patients/:id/vaccination/generate',
    perm: ['vaccination', 'create'],
    audit: { action: 'vaccinations.generate', entity: 'patient_vaccinations' },
    async handler(ctx: Ctx) {
      const patient = await patientOf(Number(ctx.params.id));
      if (!patient) throw notFound();
      const input = await ctx.body(z.object({ status: z.enum(['planned', 'done']).default('planned') }));
      const { enabled, schedule } = await vaccinationCalendar();
      if (!enabled) throw new ApiError(409, 'errors.vaccinationCalendarEmpty', 'le carnet vaccinal est désactivé dans Administration » Vaccination');
      const plan = vaccinationPlan(schedule, patient.birthDate);
      if (!plan.length) throw new ApiError(409, 'errors.vaccinationCalendarEmpty', 'calendrier vaccinal vide — ajoutez d’abord des vaccins (Administration » Vaccination)');

      const db = ctx.db;
      const existing = await dosesOfPatient(patient.id);
      const seen = new Set(existing.map((r) => `${String(r.vaccine_key)}#${Number(r.dose_no ?? 1)}`));
      const byKey = await scheduleByKey();
      let created = 0;
      const createdRows: { id: number; code: string; vaccineKey: string; doseNo: number; dueAt: string | null }[] = [];
      for (const dose of plan) {
        const key = `${dose.vaccineKey}#${dose.doseNo}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const label = pickLabel((byKey.get(dose.vaccineKey)?.label ?? {}) as MultiLabel, ctx.user?.locale ?? 'fr') || dose.vaccineKey;
        const result = await db.transaction(async (tx) => {
          const { code } = await allocateSuffixed('vaccination', 'VAX', tx);
          const row = {
            code,
            patient_id: patient.id,
            vaccine_key: dose.vaccineKey,
            dose_no: dose.doseNo,
            status: input.status,
            administered_at: input.status === 'done' ? new Date().toISOString().slice(0, 10) : null,
            due_at: dose.dueAt,
            site: null,
            batch: null,
            practitioner_id: null,
            location_id: null,
            record_id: null,
            notes: null,
            created_by: ctx.user?.uid ?? null,
          };
          const ins = await tx.insert('patient_vaccinations', row);
          return { id: Number(ins.id), code };
        });
        created++;
        createdRows.push({ id: result.id, code: result.code, vaccineKey: dose.vaccineKey, doseNo: dose.doseNo, dueAt: dose.dueAt });
        await pushHistory(ctx.user?.uid ?? null, {
          patientId: patient.id,
          kind: 'vaccination',
          refId: result.id,
          refCode: result.code,
          summary: summaryOf({ status: input.status, administered_at: null, due_at: dose.dueAt }, label, dose.doseNo),
          detail: { vaccineKey: dose.vaccineKey, doseNo: dose.doseNo, generated: true },
        });
      }
      ctx.resultId = createdRows[0]?.id;
      await bumpTag('vaccinations');
      return { ok: true, created, skipped: plan.length - created, plan: plan.length, rows: createdRows };
    },
  });

  /* ------------------------------------------------------------------ CRUD des doses */
  registerCrud({
    resource: 'vaccinations',
    table: 'patient_vaccinations',
    perm: 'vaccination',
    softDelete: true,
    search: ['code', 'vaccine_key', 'batch', 'site'],
    defaultSort: ['id', 'desc'],
    bodyCreate: vaccinationDoseZ,
    bodyUpdate: vaccinationDoseUpdateZ,
    async mapInput(input, ctx, mode, prev) {
      const db = ctx.db;
      const vaccineKey = String(input.vaccineKey ?? prev?.vaccine_key ?? '');
      const doseNo = Number(input.doseNo ?? prev?.dose_no ?? 1);
      const patientId = Number(input.patientId ?? prev?.patient_id ?? 0);
      if (!patientId) throw new ApiError(400, 'errors.validation', 'patient requis', { patientId: true });
      const patient = await patientOf(patientId);
      if (!patient) throw new ApiError(400, 'errors.validation', 'patient introuvable', { patientId: true });

      // clé du calendrier : une saisie libre est acceptée (vaccin hors calendrier national) mais une
      // clé malformée casserait le rapprochement carnet ↔ calendrier.
      if (!/^[a-z0-9_]{2,30}$/.test(vaccineKey)) {
        throw new ApiError(400, 'errors.validation', 'clé de vaccin invalide (minuscules, chiffres, tiret bas)', { vaccineKey: 'vaccineKey' });
      }
      // unicité clinique : une seule ligne active par (patient, vaccin, n° de dose)
      const dupes = await db.find<Record<string, unknown>>('patient_vaccinations', {
        where: [
          { field: 'patient_id', op: 'eq', value: patientId },
          { field: 'vaccine_key', op: 'eq', value: vaccineKey },
          { field: 'dose_no', op: 'eq', value: doseNo },
          { field: 'archived_at', op: 'isNull' },
        ],
        limit: 2,
      });
      const conflict = dupes.find((r) => mode === 'create' || Number(r.id) !== Number(prev?.id));
      if (conflict) {
        throw new ApiError(409, 'errors.duplicateDose', `dose ${doseNo} de « ${vaccineKey} » déjà enregistrée pour ce patient (${String(conflict.code ?? '')})`);
      }

      const byKey = await scheduleByKey();
      const entry = byKey.get(vaccineKey);
      const status = String(input.status ?? prev?.status ?? 'done');

      /**
       * Champ facultatif en mise à jour partielle : ABSENT (undefined) = on conserve la valeur
       * stockée, `null` explicite = on vide le champ. Confondre les deux rendrait impossible
       * l'effacement d'un lot, d'un site d'injection ou d'une note déjà saisis.
       */
      const pick = (key: string, prevCol: string): unknown => {
        const v = (input as Record<string, unknown>)[key];
        return v === undefined ? (prev?.[prevCol] ?? null) : (v ?? null);
      };

      const administeredAt = pick('administeredAt', 'administered_at') as string | null;
      // une dose administrée SANS date reçoit la date du jour (saisie rapide en consultation) ;
      // une dose planifiée ne porte jamais de date d'administration.
      const dueAt =
        (pick('dueAt', 'due_at') as string | null) || (entry ? vaccinationPlan([entry], patient.birthDate)[doseNo - 1]?.dueAt ?? null : null);

      return {
        patient_id: patientId,
        vaccine_key: vaccineKey,
        dose_no: doseNo,
        status,
        administered_at: status === 'done' ? (administeredAt ? String(administeredAt).slice(0, 10) : new Date().toISOString().slice(0, 10)) : null,
        due_at: dueAt ? String(dueAt).slice(0, 10) : null,
        site: pick('site', 'site') as string | null,
        batch: pick('batch', 'batch') as string | null,
        practitioner_id: pick('practitionerId', 'practitioner_id') as number | null,
        location_id: pick('locationId', 'location_id') as number | null,
        record_id: pick('recordId', 'record_id') as number | null,
        notes: pick('notes', 'notes') as string | null,
        ...(mode === 'create' ? { created_by: ctx.user?.uid ?? null } : {}),
      };
    },
    allocateCode: async (tx) => (await allocateSuffixed('vaccination', 'VAX', tx)).code,
    baseWhere: (ctx) => (ctx.query.get('patientId') ? [{ field: 'patient_id', op: 'eq' as const, value: Number(ctx.query.get('patientId')) }] : []),
    async decorate(rows, ctx) {
      const db = ctx.db;
      const lang = ctx.user?.locale ?? 'fr';
      const byKey = await scheduleByKey();
      const patientIds = [...new Set(rows.map((r) => Number(r.patient_id)).filter(Boolean))];
      const pracIds = [...new Set(rows.map((r) => Number(r.practitioner_id)).filter(Boolean))];
      const locIds = [...new Set(rows.map((r) => Number(r.location_id)).filter(Boolean))];
      const [patients, pracs, locs] = await Promise.all([
        patientIds.length ? db.find<Record<string, unknown>>('patients', { where: { id: patientIds } }) : Promise.resolve([]),
        pracIds.length ? db.find<Record<string, unknown>>('practitioners', { where: { id: pracIds } }) : Promise.resolve([]),
        locIds.length ? db.find<Record<string, unknown>>('locations', { where: { id: locIds } }) : Promise.resolve([]),
      ]);
      const patBy = new Map(patients.map((p) => [Number(p.id), p]));
      const pracBy = new Map(pracs.map((p) => [Number(p.id), `${p.last_name ?? ''} ${p.first_name ?? ''}`.trim()]));
      const locBy = new Map(locs.map((l) => [Number(l.id), (l.name_json ?? {}) as MultiLabel]));
      return rows.map((r) => {
        const key = String(r.vaccine_key);
        const entry = byKey.get(key);
        const p = patBy.get(Number(r.patient_id));
        return {
          ...r,
          vaccine_label: pickLabel((entry?.label ?? {}) as MultiLabel, lang) || key,
          vaccine_age_label: String(entry?.ageLabel ?? ''),
          vaccine_mandatory: Boolean(entry?.mandatory),
          in_schedule: Boolean(entry),
          patient_code: p ? String(p.code ?? '') : null,
          patient_name: p ? `${String(p.last_name ?? '')} ${String(p.first_name ?? '')}`.trim() : null,
          practitioner_name: r.practitioner_id ? pracBy.get(Number(r.practitioner_id)) ?? null : null,
          location_label: r.location_id ? pickLabel(locBy.get(Number(r.location_id)) ?? {}, lang) : null,
        };
      });
    },
    async onAfterCreate(id, row, ctx) {
      const byKey = await scheduleByKey();
      const label = pickLabel((byKey.get(String(row.vaccine_key))?.label ?? {}) as MultiLabel, ctx.user?.locale ?? 'fr') || String(row.vaccine_key);
      await pushHistory(ctx.user?.uid ?? null, {
        patientId: Number(row.patient_id),
        kind: 'vaccination',
        refId: id,
        refCode: String(row.code),
        summary: summaryOf(row, label, Number(row.dose_no ?? 1)),
        detail: { vaccineKey: row.vaccine_key, doseNo: row.dose_no, status: row.status },
      });
      await bumpTag('vaccinations');
    },
    async onAfterUpdate(id, before, after, ctx) {
      const byKey = await scheduleByKey();
      const label = pickLabel((byKey.get(String(after.vaccine_key))?.label ?? {}) as MultiLabel, ctx.user?.locale ?? 'fr') || String(after.vaccine_key);
      if (String(before.status) !== String(after.status) || String(before.administered_at ?? '') !== String(after.administered_at ?? '')) {
        await pushHistory(ctx.user?.uid ?? null, {
          patientId: Number(after.patient_id),
          kind: 'vaccination',
          refId: id,
          refCode: String(after.code),
          summary: summaryOf(after, label, Number(after.dose_no ?? 1)),
          detail: { vaccineKey: after.vaccine_key, doseNo: after.dose_no, status: after.status, previousStatus: before.status },
        });
      }
      await bumpTag('vaccinations');
    },
    bump: ['vaccinations'],
  });
}

/** Statistiques globales (carte du hub Administration) — count par statut, aucun PHI. */
export async function vaccinationStats(): Promise<{ total: number; done: number; planned: number; patients: number }> {
  return cached('vaccinations', 'stats', 30_000, async () => {
    const db = await getDb();
    const rows = await db.find<Record<string, unknown>>('patient_vaccinations', {
      where: [{ field: 'archived_at', op: 'isNull' }],
      limit: 20_000,
    });
    const patients = new Set(rows.map((r) => Number(r.patient_id)));
    return {
      total: rows.length,
      done: rows.filter((r) => String(r.status) === 'done').length,
      planned: rows.filter((r) => String(r.status) === 'planned').length,
      patients: patients.size,
    };
  });
}
