/**
 * WORKFLOW DU DOSSIER (§8.3) + DÉPLACEMENTS (§8.3) — machine à états configurable (settings.workflowSteps).
 * Étapes : intervenant(s), lieu, date/heure, documents ; transition « advance » contrôlée ; kanban par étape.
 * Déplacements : transferts entre lieux avec statut/horodatage/responsable (MOV-00001).
 */
import { z } from 'zod';
import { movementZ, pickLabel, type MultiLabel } from '@sardpi/shared';
import { route, type Ctx } from '../http/router';
import { registerCrud } from '../http/crud';
import { notFound, ApiError } from '../http/errors';
import { getSection } from '../settings';
import { allocateSuffixed } from '../codes/service';
import { pushHistory } from './history';
import { getDb } from '../data';
import type { DataAdapter } from '../data/types';

type StepDef = { key: string; order: number; color: string; label: Record<string, string> };

async function steps(): Promise<StepDef[]> {
  const wf = (await getSection('workflowSteps')) as { steps: StepDef[] };
  return [...(wf.steps ?? [])].sort((a, b) => a.order - b.order);
}

/** Étapes (defs) fusionnées avec les case_steps d'un dossier donné. */
async function stepsForCase(db: DataAdapter, caseId: number, defs: StepDef[]) {
  const rows = await db.find<Record<string, unknown>>('case_steps', { where: { case_id: caseId }, orderBy: [['seq', 'asc']] });
  const byKey = new Map(rows.map((r) => [String(r.step_key), r]));
  return defs.map((d) => {
    const r = byKey.get(d.key);
    return { ...d, id: r?.id ?? null, status: (r?.status as string) ?? 'todo', planned_at: r?.planned_at ?? null, done_at: r?.done_at ?? null, location_id: r?.location_id ?? null, practitioners: parseArr(r?.practitioners_json), documents: parseArr(r?.documents_json), note: r?.note ?? null };
  });
}

/** Étiquette multilingue sûre depuis une colonne *_json (texte ou objet). */
function asLabel(v: unknown): MultiLabel {
  return (jp(v) ?? {}) as unknown as MultiLabel;
}

/** JSON.parse tolérant → objet | null (les colonnes *_json peuvent arriver en texte selon l'adaptateur). */
function jp(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object') return v as Record<string, unknown>;
  if (typeof v === 'string' && v) {
    try { const o = JSON.parse(v); return o && typeof o === 'object' ? (o as Record<string, unknown>) : null; } catch { return null; }
  }
  return null;
}

/** Libellé + couleur d'une catégorie (intervention_categories) par préfixe. */
async function categoryInfo(db: DataAdapter, prefix: string | null, lang: string): Promise<{ label: string; color: string | null; icon: string | null }> {
  if (!prefix) return { label: lang === 'ar' ? 'ملف المتابعة' : lang === 'es' ? 'Expediente de seguimiento' : lang === 'en' ? 'Care record' : 'Dossier de suivi', color: null, icon: null };
  const c = await db.findOne<Record<string, unknown>>('intervention_categories', { prefix });
  return { label: c ? pickLabel(asLabel(c.label_json), lang) || prefix : prefix, color: c ? String(c.color ?? '') || null : null, icon: c ? String(c.icon ?? '') || null : null };
}

export function registerWorkflow(): void {
  /** Dossier courant d'un patient + ses étapes (stepper/kanban). */
  route({
    method: 'GET',
    path: '/cases/current',
    perm: ['patient_case', 'view'],
    async handler(ctx: Ctx) {
      const db = ctx.db;
      const defs = await steps();
      const caseId = Number(ctx.query.get('caseId') ?? 0);
      const patientId = Number(ctx.query.get('patientId') ?? 0);
      let kase: Record<string, unknown> | null = null;
      if (caseId) {
        kase = await db.findOne<Record<string, unknown>>('patient_cases', { id: caseId });
      } else if (patientId) {
        // dossier de suivi GLOBAL (catégorie null) de préférence ; sinon le plus récent
        kase = await db.findOne<Record<string, unknown>>('patient_cases', { where: [{ field: 'patient_id', op: 'eq' as const, value: patientId }, { field: 'category_prefix', op: 'isNull' as const }], orderBy: [['id', 'desc']], limit: 1 });
        if (!kase) kase = await db.findOne<Record<string, unknown>>('patient_cases', { where: { patient_id: patientId }, orderBy: [['id', 'desc']], limit: 1 });
      } else {
        throw new ApiError(400, 'errors.validation', 'patientId ou caseId requis');
      }
      if (!kase) return { case: null, steps: defs.map((d) => ({ ...d, status: 'todo' })) };
      return { case: kase, steps: await stepsForCase(db, Number(kase.id), defs) };
    },
  });

  /** Avancer à l'étape suivante (ou forcer une étape), en consignant le contexte. */
  route({
    method: 'POST',
    path: '/cases/advance',
    perm: ['patient_case', 'update'],
    audit: { action: 'case.advance', entity: 'patient_cases' },
    async handler(ctx: Ctx) {
      const input = await ctx.body(
        z.object({
          caseId: z.number().int().positive(),
          stepKey: z.string().max(30),
          status: z.enum(['done', 'in_progress', 'skipped', 'todo']).default('done'),
          locationId: z.number().int().nullable().optional(),
          practitionerIds: z.array(z.number().int()).max(10).default([]),
          documents: z.array(z.string().max(24)).max(20).default([]),
          note: z.string().max(600).optional().nullable(),
          at: z.string().optional().nullable(),
        }),
      );
      const db = ctx.db;
      const kase = await db.findOne<Record<string, unknown>>('patient_cases', { id: input.caseId });
      if (!kase) throw notFound();
      const defs = await steps();
      const idx = defs.findIndex((d) => d.key === input.stepKey);
      if (idx < 0) throw new ApiError(400, 'errors.validation', 'étape inconnue', { stepKey: true });
      const stepRow = await db.findOne<Record<string, unknown>>('case_steps', { case_id: input.caseId, step_key: input.stepKey });
      const patch = {
        status: input.status,
        done_at: input.status === 'done' ? input.at ?? new Date().toISOString() : null,
        location_id: input.locationId ?? null,
        practitioners_json: input.practitionerIds,
        documents_json: input.documents,
        note: input.note ?? null,
        updated_at: new Date().toISOString(),
      };
      if (stepRow) await db.update('case_steps', Number(stepRow.id), patch);
      else await db.insert('case_steps', { case_id: input.caseId, step_key: input.stepKey, seq: idx + 1, ...patch });
      // le courant = dernière étape commencée
      const nextStep = input.status === 'done' ? (defs[idx + 1]?.key ?? input.stepKey) : input.stepKey;
      await db.update('patient_cases', input.caseId, { current_step: nextStep });
      // annulation d'une étape (todo/in_progress) sur un dossier clôturé → on le réouvre
      if (input.status !== 'done') {
        const kase2 = await db.findOne<Record<string, unknown>>('patient_cases', { id: input.caseId });
        if (kase2 && kase2.status === 'closed') await db.update('patient_cases', input.caseId, { status: 'open', closed_at: null });
      }
      if (input.status === 'done' && defs[idx + 1]) {
        const nx = await db.findOne<Record<string, unknown>>('case_steps', { case_id: input.caseId, step_key: defs[idx + 1]!.key });
        if (nx) await db.update('case_steps', Number(nx.id), { status: 'in_progress', updated_at: new Date().toISOString() });
      }
      // clôture du dossier quand la dernière étape est finie
      if (input.status === 'done' && idx === defs.length - 1) {
        await db.update('patient_cases', input.caseId, { status: 'closed', closed_at: new Date().toISOString(), current_step: input.stepKey });
      }
      ctx.resultId = input.caseId;
      // libellé d'historique localisé : « annulée » (et non « todo ») quand on annule une étape
      const stepName = (lg: string): string => {
        const lbl = defs[idx]!.label as Record<string, string> | string | undefined;
        return typeof lbl === 'string' && lbl ? lbl : (lbl as Record<string, string>)?.[lg] ?? (lbl as Record<string, string>)?.fr ?? defs[idx]!.key;
      };
      const WORD: Record<string, { fr: string; ar: string; es: string; en: string }> = {
        done: { fr: 'terminée', ar: 'منجزة', es: 'completada', en: 'completed' },
        in_progress: { fr: 'en cours', ar: 'قيد التنفيذ', es: 'en curso', en: 'in progress' },
        skipped: { fr: 'passée sans suite', ar: 'متخطّاة', es: 'omitida', en: 'skipped' },
        todo: { fr: 'annulée', ar: 'ملغاة', es: 'cancelada', en: 'cancelled' },
      };
      const w = WORD[input.status] ?? WORD.done!;
      await pushHistory(ctx.user!.uid, {
        patientId: Number(kase.patient_id),
        kind: 'case',
        refId: input.caseId,
        refCode: String(kase.code),
        summary: { fr: `Étape « ${stepName('fr')} » ${w.fr}`, ar: `خطوة « ${stepName('ar')} » : ${w.ar}`, es: `Paso « ${stepName('es')} » ${w.es}`, en: `Step “${stepName('en')}” ${w.en}` },
        detail: { locationId: input.locationId, practitioners: input.practitionerIds, stepStatus: input.status },
      });
      return { ok: true, current_step: nextStep };
    },
  });

  // Créer le dossier de suivi d'un patient (workflow à la demande — un seul dossier ouvert par patient).
  route({
    method: 'POST',
    path: '/cases',
    perm: ['patient_case', 'create'],
    audit: { action: 'case.create', entity: 'patient_cases' },
    async handler(ctx: Ctx) {
      const input = await ctx.body(z.object({ patientId: z.number().int().positive(), firstStep: z.string().max(30).optional(), categoryPrefix: z.string().max(10).nullable().optional() }));
      const db = ctx.db;
      const pat = await db.findOne<Record<string, unknown>>('patients', { id: input.patientId });
      if (!pat) throw notFound();
      const cat = (input.categoryPrefix ?? null) as string | null;
      // un dossier ouvert PAR (patient, catégorie) — catégorie null = dossier de suivi global
      const openWhere = [
        { field: 'patient_id', op: 'eq' as const, value: input.patientId },
        { field: 'status', op: 'eq' as const, value: 'open' },
        cat ? { field: 'category_prefix', op: 'eq' as const, value: cat } : { field: 'category_prefix', op: 'isNull' as const },
      ];
      const open = await db.findOne<Record<string, unknown>>('patient_cases', { where: openWhere, orderBy: [['id', 'desc']], limit: 1 });
      if (open) {
        ctx.resultId = Number(open.id);
        return { ok: true, id: Number(open.id), code: String(open.code), alreadyOpen: true, categoryPrefix: cat };
      }
      const defs = await steps();
      const first = defs.find((d) => d.key === input.firstStep)?.key ?? defs[0]?.key;
      if (!first) throw new ApiError(500, 'errors.config', 'Aucune étape configurée (workflowSteps)');
      const lang = ctx.user?.locale ?? 'fr';
      const ci = await categoryInfo(db, cat, lang);
      const code = (await allocateSuffixed('case', 'CAS')).code;
      const now = new Date().toISOString();
      const ins = await db.insert('patient_cases', { code, patient_id: input.patientId, category_prefix: cat, title: ci.label, status: 'open', current_step: first, opened_at: now, created_at: now, updated_at: now });
      const id = Number((ins as { id?: number }).id ?? 0);
      await db.insert('case_steps', { case_id: id, step_key: first, seq: defs.findIndex((d) => d.key === first) + 1, status: 'in_progress', started_at: now, created_at: now, updated_at: now });
      ctx.resultId = id;
      await pushHistory(ctx.user!.uid, { patientId: input.patientId, kind: 'case', refId: id, refCode: code, summary: { fr: `Dossier « ${ci.label} » ouvert`, ar: `تم فتح ملف « ${ci.label} »`, en: `Record “${ci.label}” opened` }, detail: { categoryPrefix: cat } });
      return { ok: true, id, code, alreadyOpen: false, categoryPrefix: cat };
    },
  });

  /** Réouvrir un dossier clôturé (transitions configurables — ici : toute étape peut être remise en cours). */
  route({
    method: 'POST',
    path: '/cases/:id/reopen',
    perm: ['patient_case', 'update'],
    audit: { action: 'case.reopen', entity: 'patient_cases' },
    async handler(ctx: Ctx) {
      const db = ctx.db;
      const id = Number(ctx.params.id);
      const kase = await db.findOne<Record<string, unknown>>('patient_cases', { id });
      if (!kase) throw notFound();
      await db.update('patient_cases', id, { status: 'open', closed_at: null });
      ctx.resultId = id;
      await pushHistory(ctx.user!.uid, { patientId: Number(kase.patient_id), kind: 'case', refId: id, refCode: String(kase.code), summary: { fr: 'Dossier réouvert', ar: 'أُعيد فتح الملف', en: 'Record reopened' }, detail: null });
      return { ok: true };
    },
  });

  /** Liste des dossiers d'un patient (un par catégorie + le global) avec compteurs. */
  route({
    method: 'GET',
    path: '/patients/:id/dossiers',
    perm: ['patient_case', 'view'],
    async handler(ctx: Ctx) {
      const db = ctx.db;
      const pid = Number(ctx.params.id);
      const lang = ctx.user?.locale ?? 'fr';
      const cases = await db.find<Record<string, unknown>>('patient_cases', { where: { patient_id: pid }, orderBy: [['id', 'desc']] });
      if (!cases.length) return { rows: [] };
      const [records, appts, rxs, docs] = await Promise.all([
        db.find<Record<string, unknown>>('medical_records', { where: { patient_id: pid } }),
        db.find<Record<string, unknown>>('appointments', { where: { patient_id: pid } }),
        db.find<Record<string, unknown>>('prescriptions', { where: { patient_id: pid } }),
        db.find<Record<string, unknown>>('ged_documents', { where: { patient_id: pid } }),
      ]);
      const rows = [];
      for (const k of cases) {
        const kid = Number(k.id);
        const cat = k.category_prefix ? String(k.category_prefix) : null;
        const ci = await categoryInfo(db, cat, lang);
        const recIds = new Set(records.filter((r) => Number(r.case_id) === kid || (!r.case_id && cat && String(r.category_prefix) === cat)).map((r) => Number(r.id)));
        const recApptIds = new Set(records.filter((r) => recIds.has(Number(r.id)) && r.appointment_id).map((r) => Number(r.appointment_id)));
        rows.push({
          id: kid,
          code: String(k.code),
          title: k.title ?? null,
          category_prefix: cat,
          category_label: ci.label,
          category_color: ci.color,
          category_icon: ci.icon,
          status: k.status,
          current_step: k.current_step ?? null,
          opened_at: k.opened_at,
          closed_at: k.closed_at,
          counts: {
            records: recIds.size,
            appointments: appts.filter((a) => Number(a.case_id) === kid || recApptIds.has(Number(a.id))).length,
            prescriptions: rxs.filter((p) => Number(p.case_id) === kid).length,
            documents: docs.filter((d) => Number(d.case_id) === kid || (d.record_id && recIds.has(Number(d.record_id)))).length,
          },
        });
      }
      return { rows };
    },
  });

  /** Détail agrégé d'un dossier : étapes + fiches + RDV + ordonnances + documents + historique (liaison hybride). */
  route({
    method: 'GET',
    path: '/dossiers/:id',
    perm: ['patient_case', 'view'],
    async handler(ctx: Ctx) {
      const db = ctx.db;
      const id = Number(ctx.params.id);
      const lang = ctx.user?.locale ?? 'fr';
      const kase = await db.findOne<Record<string, unknown>>('patient_cases', { id });
      if (!kase) throw notFound();
      const pid = Number(kase.patient_id);
      const cat = kase.category_prefix ? String(kase.category_prefix) : null;
      const ci = await categoryInfo(db, cat, lang);
      const defs = await steps();
      const stepsOut = await stepsForCase(db, id, defs);

      const [allRecords, allAppts, allRx, allDocs, allHist, types, pracs, locs] = await Promise.all([
        db.find<Record<string, unknown>>('medical_records', { where: { patient_id: pid }, orderBy: [['id', 'desc']] }),
        db.find<Record<string, unknown>>('appointments', { where: { patient_id: pid }, orderBy: [['start_at', 'desc']] }),
        db.find<Record<string, unknown>>('prescriptions', { where: { patient_id: pid }, orderBy: [['id', 'desc']] }),
        db.find<Record<string, unknown>>('ged_documents', { where: { patient_id: pid }, orderBy: [['id', 'desc']] }),
        db.find<Record<string, unknown>>('history_events', { where: { patient_id: pid }, orderBy: [['occurred_at', 'desc']], limit: 300 }),
        db.find<Record<string, unknown>>('intervention_types', {}),
        db.find<Record<string, unknown>>('practitioners', {}),
        db.find<Record<string, unknown>>('locations', {}),
      ]);

      // liaison hybride : case_id explicite SINON repli catégorie (fiches) / rattachement (RDV via fiche, documents via fiche)
      const records = allRecords.filter((r) => Number(r.case_id) === id || (!r.case_id && cat && String(r.category_prefix) === cat));
      const recIds = new Set(records.map((r) => Number(r.id)));
      const recApptIds = new Set(records.filter((r) => r.appointment_id).map((r) => Number(r.appointment_id)));
      const appointments = allAppts.filter((a) => Number(a.case_id) === id || recApptIds.has(Number(a.id)));
      const prescriptions = allRx.filter((p) => Number(p.case_id) === id);
      const rxIds = new Set(prescriptions.map((p) => Number(p.id)));
      const documents = allDocs.filter((d) => Number(d.case_id) === id || (d.record_id && recIds.has(Number(d.record_id))));
      const docIds = new Set(documents.map((d) => Number(d.id)));

      const typeBy = new Map<number, MultiLabel>(types.map((t) => [Number(t.id), asLabel(t.name_json)]));
      const pracBy = new Map(pracs.map((p) => [Number(p.id), `${p.last_name ?? ''} ${p.first_name ?? ''}`.trim()]));
      const locBy = new Map<number, MultiLabel>(locs.map((l) => [Number(l.id), asLabel(l.name_json)]));

      const history = allHist
        .filter((h) => {
          const kind = String(h.kind);
          const rid = Number(h.ref_id);
          return (kind === 'case' && rid === id) || ((kind === 'record' || kind === 'lab') && recIds.has(rid)) || (kind === 'rx' && rxIds.has(rid)) || (kind === 'ged' && docIds.has(rid));
        })
        .map((h) => {
          const detail = jp(h.detail_json);
          const stepStatus = detail ? String(detail.stepStatus ?? '') : '';
          const tone = stepStatus === 'todo' ? 'cancel' : stepStatus === 'done' ? 'ok' : stepStatus ? 'warn' : null;
          return { id: Number(h.id), kind: h.kind, at: h.occurred_at, ref_code: h.ref_code ?? null, tone, summary: jp(h.summary_json) };
        });

      return {
        case: { ...kase, category_prefix: cat, category_label: ci.label, category_color: ci.color, category_icon: ci.icon },
        steps: stepsOut,
        records: records.map((r) => ({ id: Number(r.id), code: String(r.code), category_prefix: r.category_prefix, type_label: pickLabel(typeBy.get(Number(r.type_id)) ?? ({} as MultiLabel), lang), summary: jp(r.summary_json), act_date: r.act_date, status: r.status, appointment_id: r.appointment_id ?? null })),
        appointments: appointments.map((a) => ({ id: Number(a.id), code: String(a.code), start_at: a.start_at, end_at: a.end_at, status: a.status, reason: a.reason ?? null, practitioner_name: a.practitioner_id ? pracBy.get(Number(a.practitioner_id)) ?? null : null, location_name: a.location_id ? pickLabel(locBy.get(Number(a.location_id)) ?? ({} as MultiLabel), lang) : null })),
        prescriptions: prescriptions.map((p) => ({ id: Number(p.id), code: String(p.code), act_date: p.act_date, status: p.status, practitioner_name: p.practitioner_id ? pracBy.get(Number(p.practitioner_id)) ?? null : null })),
        documents: documents.map((d) => ({ id: Number(d.id), code: String(d.code), title: d.title ?? null, type_prefix: d.type_prefix, current_version: d.current_version ?? 1, record_id: d.record_id ?? null, created_at: d.created_at })),
        history,
      };
    },
  });

  /* --------------------------------------------------------- déplacements */
  registerCrud({
    resource: 'movements',
    table: 'patient_movements',
    perm: 'movement',
    search: ['code', 'reason'],
    defaultSort: ['id', 'desc'],
    bodyCreate: movementZ,
    bodyUpdate: movementZ.partial(),
    mapInput: async (i) => ({
      patient_id: i.patientId,
      from_location_id: i.fromLocationId ?? null,
      to_location_id: i.toLocationId,
      reason: i.reason ?? null,
      status: i.status ?? 'pending',
      at: i.at ?? new Date().toISOString(),
      responsible_practitioner_id: i.responsiblePractitionerId ?? null,
    }),
    allocateCode: async (tx) => (await allocateSuffixed('movement', 'MOV', tx)).code,
    baseWhere: (ctx) => (ctx.query.get('patientId') ? [{ field: 'patient_id', op: 'eq' as const, value: Number(ctx.query.get('patientId')) }] : []),
    decorate: async (rows, ctx) => {
      const db = await getDb();
      const ids = [...new Set(rows.flatMap((r) => [r.from_location_id, r.to_location_id, r.responsible_practitioner_id]).filter(Boolean).map(Number))];
      const locs = await db.find<Record<string, unknown>>('locations', { where: { id: ids } });
      const prs = await db.find<Record<string, unknown>>('practitioners', { where: { id: ids } });
      const locBy = new Map(locs.map((l) => [Number(l.id), (l.name_json ?? {}) as Record<string, string>]));
      const prBy = new Map(prs.map((p) => [Number(p.id), `${p.last_name} ${p.first_name}`]));
      const lang = ctx.user?.locale ?? 'fr';
      return rows.map((r) => ({
        ...r,
        from_label: r.from_location_id ? pickLabel(locBy.get(Number(r.from_location_id)), lang) : null,
        to_label: r.to_location_id ? pickLabel(locBy.get(Number(r.to_location_id)), lang) : null,
        responsible_name: r.responsible_practitioner_id ? prBy.get(Number(r.responsible_practitioner_id)) ?? null : null,
      }));
    },
    async onAfterCreate(id, row, ctx) {
      await pushHistory(ctx.user!.uid, { patientId: Number(row.patient_id), kind: 'movement', refId: id, refCode: String(row.code), summary: { fr: 'Déplacement enregistré', ar: 'تم تسجيل تنقل', en: 'Movement recorded' }, detail: { to: row.to_location_id, status: row.status } });
    },
    bump: ['calendar'],
  });
}

function parseArr(v: unknown): number[] | string[] {
  if (Array.isArray(v)) return v as never;
  if (typeof v === 'string' && v) {
    try {
      return JSON.parse(v) as never;
    } catch {
      return [];
    }
  }
  return [];
}
