/**
 * MODULE « SECTIONS MÉDICALES » (§8.4) — fiches configurables par catégorie, code COMBINÉ
 *   PAT-00001-AAAAMMJJ-{PRÉFIXE}-{NN} alloué en transaction sous verrou (SEQ propre à patient+date+catégorie).
 * La permission est résolue PAR CATÉGORIE (`record.<module>.<action>`) car les catégories sont administrables.
 * Laboratoire : valeurs structurées avec bornes de référence (selon sexe/âge) → drapeaux normal/bas/haut/CRITIQUE.
 * Chaque fiche reçoit un jeton de vérification public (QR) — meta NON nominatif.
 */
import { z } from 'zod';
import { medicalRecordCreateZ, medicalRecordUpdateZ, pickLabel, can } from '@sardpi/shared';
import { route, type Ctx } from '../http/router';
import { ApiError, notFound, zodDetails } from '../http/errors';
import { getDb } from '../data';
import { allocateRecordCode } from '../codes/service';
import { publicToken, zonedDate } from '../util';
import { cached, bumpTag } from '../cache';
import { env } from '../config';
import { pushHistory } from './history';
import { sanitizeRow } from '../http/crud';
import { audit } from '../audit';

export interface CatLite { id: number; code: string; prefix: string; module: string; label: unknown; color: string; icon: string }

/** TOUTES les catégories actives (liste) — plusieurs catégories peuvent partager un même module
 * applicatif (ex. « record.consultation » pour CON et ORD) : une Map indexée par module les
 * écraserait, d'où cette liste complète pour la résolution par code/préfixe/module. */
export async function categoryList(): Promise<CatLite[]> {
  return cached('refs', 'categories', 300_000, async () => {
    const db = await getDb();
    const rows = await db.find<Record<string, unknown>>('intervention_categories', { where: { active: 1 } });
    return rows.map((r) => ({ id: Number(r.id), code: String(r.code ?? ''), prefix: String(r.prefix), module: String(r.module), label: (r.label_json ?? {}) as never, color: String(r.color ?? ''), icon: String(r.icon ?? '') }));
  });
}

export async function categoryByModule(): Promise<Map<string, CatLite>> {
  const list = await categoryList();
  const m = new Map<string, CatLite>();
  for (const c of list) if (!m.has(c.module)) m.set(c.module, c);
  return m;
}

async function typesMap(): Promise<Map<number, Record<string, unknown>>> {
  return cached('refs', 'intervention_types', 300_000, async () => {
    const db = await getDb();
    const rows = await db.find<Record<string, unknown>>('intervention_types', { where: { active: 1 } });
    return new Map(rows.map((r) => [Number(r.id), r]));
  });
}

/** Résout une catégorie d'intervention par n'importe quelle forme : module complet
 * (« record.lab »), forme courte (« lab ») ou préfixe (« LAB ») — le menu et les liens
 * historiques utilisent le préfixe ; l'API accepte les trois. */
export async function resolveCategory(raw: string): Promise<CatLite | null> {
  const list = await categoryList();
  const key = String(raw ?? '').trim();
  if (!key) return null;
  const lower = key.toLowerCase();
  // 1) module complet exact (« record.lab ») — 2) préfixe (« LAB ») — 3) code (« CONSULT ») — 4) forme courte (« lab »)
  return (
    list.find((c) => c.module === key) ??
    list.find((c) => c.prefix.toLowerCase() === lower) ??
    list.find((c) => c.code.toLowerCase() === lower) ??
    list.find((c) => c.module.toLowerCase() === `record.${lower}` || c.module.toLowerCase() === lower) ??
    null
  );
}

async function guard(ctx: Ctx, categoryModule: string, action: 'view' | 'create' | 'update' | 'delete' | 'validate' | 'archive' | 'export' | 'print' | 'pdf' | 'email'): Promise<void> {
  const cat = await resolveCategory(categoryModule);
  if (!cat) throw notFound();
  // cat.module contient DÉJÀ la clé complète du module de permission (ex. « record.lab ») — telle que
  // déclarée dans le profil de catégorie admin (alignée sur MODULES partagé front/back).
  if (!can(ctx.user?.perms, cat.module, action)) throw new ApiError(403, 'errors.forbidden');
}

/** Calcule le drapeau d'une valeur de laboratoire selon bornes (âge/sexe appliqués). */
export function labFlag(valueNum: number, p: { ref_min: number | null; ref_max: number | null; crit_low: number | null; crit_high: number | null; age_min?: number | null; age_max?: number | null }): 'normal' | 'low' | 'high' | 'critical' {
  const min = p.ref_min, max = p.ref_max;
  if (p.crit_low != null && valueNum <= p.crit_low) return 'critical';
  if (p.crit_high != null && valueNum >= p.crit_high) return 'critical';
  if (min != null && valueNum < min) return 'low';
  if (max != null && valueNum > max) return 'high';
  return 'normal';
}

async function decorateRecords(rows: Record<string, unknown>[], ctx: Ctx): Promise<Record<string, unknown>[]> {
  const db = ctx.db;
  const types = await typesMap();
  const patientIds = [...new Set(rows.map((r) => Number(r.patient_id)))];
  const patients = patientIds.length ? await db.find<Record<string, unknown>>('patients', { where: { id: patientIds } }) : [];
  const pById = new Map(patients.map((p) => [Number(p.id), p]));
  const recIds = rows.map((r) => Number(r.id));
  const lab = recIds.length ? await db.find<Record<string, unknown>>('lab_results', { where: { record_id: recIds }, limit: 4000 }) : [];
  const labByRec = new Map<number, Record<string, unknown>[]>();
  for (const l of lab) {
    const rid = Number(l.record_id);
    if (!labByRec.has(rid)) labByRec.set(rid, []);
    labByRec.get(rid)!.push(l);
  }
  const teams = recIds.length ? await db.find<Record<string, unknown>>('record_practitioners', { where: { record_id: recIds }, limit: 4000 }) : [];
  const teamByRec = new Map<number, number[]>();
  for (const t of teams) {
    const rid = Number(t.record_id);
    if (!teamByRec.has(rid)) teamByRec.set(rid, []);
    teamByRec.get(rid)!.push(Number(t.practitioner_id));
  }
  const prIds = [...new Set([...teamByRec.values()].flat())];
  const practs = prIds.length ? await db.find<Record<string, unknown>>('practitioners', { where: { id: prIds } }) : [];
  const practById = new Map(practs.map((p) => [Number(p.id), `${p.last_name} ${p.first_name}` as unknown]));
  const apptIds = [...new Set(rows.map((r) => Number(r.appointment_id)).filter((n) => Number.isFinite(n) && n > 0))];
  const appts = apptIds.length ? await db.find<Record<string, unknown>>('appointments', { where: { id: apptIds } }) : [];
  const apptById = new Map(appts.map((a) => [Number(a.id), a]));
  const lang = ctx.user?.locale ?? 'fr';
  return rows.map((r) => {
    const t = types.get(Number(r.type_id));
    const p = pById.get(Number(r.patient_id));
    const results = (labByRec.get(Number(r.id)) ?? []).map((l) => ({
      key: l.param_key,
      value: l.value_num != null ? Number(l.value_num) : l.value_txt,
      unit: l.unit,
      ref: l.ref_min != null || l.ref_max != null ? `${l.ref_min ?? ''}${l.ref_min != null && l.ref_max != null ? ' – ' : ''}${l.ref_max ?? ''}` : null,
      flag: l.flag,
    }));
    return {
      ...r,
      type_name: t ? pickLabel((t.name_json ?? {}) as never, lang) : r.category_prefix,
      type_label: t ? pickLabel((t.name_json ?? {}) as never, lang) : r.category_prefix,
      type_code: t?.type_code ?? null,
      patient_code: p?.code ?? null,
      patient_name: p ? `${String(p.last_name ?? '').toUpperCase()} ${p.first_name ?? ''}` : null,
      summary: r.summary_json ? pickLabel(r.summary_json as never, lang) : null,
      team: (teamByRec.get(Number(r.id)) ?? []).map((id) => practById.get(id)).filter(Boolean),
      results,
      appt: (() => {
        const a = apptById.get(Number(r.appointment_id));
        return a ? { id: Number(a.id), code: a.code ?? null, start_at: a.start_at ?? null, end_at: a.end_at ?? null, kind: a.kind ?? null } : null;
      })(),
    };
  });
}

export function registerRecords(): void {
  /** LISTE (scope : patient et/ou catégorie) */
  route({
    method: 'GET',
    path: '/records',
    async handler(ctx: Ctx) {
      const category = String(ctx.query.get('category') ?? 'consultation');
      const db = ctx.db;
      const p = z
        .object({
          patientId: z.coerce.number().int().positive().optional(),
          q: z.string().max(80).optional(),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(5).max(100).default(20),
          scope: z.enum(['active', 'archived', 'all']).default('active'),
        })
        .parse(Object.fromEntries(ctx.query.entries()));
      const cat = await resolveCategory(category);
      if (!cat) throw notFound();
      await guard(ctx, String(cat.module), 'view'); // même clé de permission que la création (record.<module>)
      const cats2 = await db.find<Record<string, unknown>>('intervention_categories');
      void cats2;
      const where: { field: string; op: 'eq'; value: unknown }[] = [{ field: 'category_prefix', op: 'eq', value: cat.prefix }];
      if (p.patientId) where.push({ field: 'patient_id', op: 'eq', value: p.patientId });
      if (p.scope === 'active') where.push({ field: 'archived_at', op: 'eq', value: null as never });
      let rows = await db.find<Record<string, unknown>>('medical_records', { where: where as never, orderBy: [['act_date', 'desc'], ['id', 'desc']] });
      if (p.scope === 'active') rows = rows.filter((r) => !r.archived_at);
      if (p.scope === 'archived') rows = rows.filter((r) => Boolean(r.archived_at));
      if (p.q?.trim()) {
        const q = p.q.trim().toLowerCase();
        rows = rows.filter((r) => String(r.code ?? '').toLowerCase().includes(q));
      }
      const total = rows.length;
      const pageRows = rows.slice((p.page - 1) * p.pageSize, (p.page - 1) * p.pageSize + p.pageSize);
      const decorated = await decorateRecords(pageRows, ctx);
      return { rows: decorated.map(sanitizeRow), total, page: p.page, pageSize: p.pageSize };
    },
  });

  /** TOUTES les fiches d'un patient (vue « Enregistrements » du dossier — toutes catégories confondues). */
  route({
    method: 'GET',
    path: '/patients/:id/records',
    perm: ['patient', 'view'],
    async handler(ctx: Ctx) {
      const id = Number(ctx.params.id);
      const db = ctx.db;
      const rows = await db.find<Record<string, unknown>>('medical_records', { where: { patient_id: id }, orderBy: [['act_date', 'desc'], ['id', 'desc']], limit: 300 });
      const allowed = await ctx.user!.perms;
      const cats = await categoryByModule();
      const visible: Record<string, unknown>[] = [];
      for (const r of rows) {
        const cat = [...cats.values()].find((c) => c.prefix === String(r.category_prefix));
        if (cat && can(allowed, `record.${cat.module}`, 'view')) visible.push(r);
      }
      const decorated = await decorateRecords(visible, ctx);
      return { rows: decorated.map(sanitizeRow) };
    },
  });

  /** DÉTAIL */
  route({
    method: 'GET',
    path: '/records/:id',
    async handler(ctx: Ctx) {
      const db = ctx.db;
      const row = await db.findOne<Record<string, unknown>>('medical_records', { id: Number(ctx.params.id) });
      if (!row) throw notFound();
      await guard(ctx, await moduleOfCategoryPrefix(String(row.category_prefix)), 'view');
      const [d] = await decorateRecords([row], ctx);
      return sanitizeRow(d!);
    },
  });

  /** CRÉATION — code combiné sous verrou, drapeaux labo, équipe, jeton QR, historique. */
  route({
    method: 'POST',
    path: '/records',
    audit: { action: 'records.create', entity: 'medical_records' },
    async handler(ctx: Ctx) {
      let input;
      try {
        input = medicalRecordCreateZ.parse(await ctx.req.json());
      } catch (e) {
        if (e instanceof z.ZodError) throw new ApiError(422, 'errors.validation', 'validation', zodDetails(e));
        throw e;
      }
      const db = ctx.db;
      const patient = await db.findOne<Record<string, unknown>>('patients', { id: input.patientId });
      if (!patient || patient.archived_at) throw new ApiError(400, 'errors.validation', 'patient introuvable', { patientId: true });
      const types = await typesMap();
      const type = types.get(input.typeId);
      if (!type) throw new ApiError(400, 'errors.validation', 'type inconnu', { typeId: true });
      const catPrefix = String(type.category_prefix);
      const cats = await db.find<Record<string, unknown>>('intervention_categories', { where: { prefix: catPrefix } });
      const cat = cats[0];
      if (!cat) throw new ApiError(400, 'errors.validation', 'catégorie inactive', { type: true });
      await guard(ctx, String(cat.module), 'create');

      const out = await db.transaction(async (tx) => {
        const alloc = await allocateRecordCode(String(patient.code), input.patientId, catPrefix, input.actDate, tx);
        const token = publicToken();
        const row = await tx.insert('medical_records', {
          code: alloc.code,
          patient_id: input.patientId,
          type_id: input.typeId,
          category_prefix: catPrefix,
          appointment_id: input.apptId ?? null,
          act_date: new Date(input.actDate.length <= 10 ? `${input.actDate}T12:00:00` : input.actDate).toISOString(),
          status: input.status,
          summary_json: input.summary ?? null,
          fields_json: input.fields ?? {},
          icd10_json: input.icd10 ?? [],
          location_id: input.locationId ?? null,
          author_user_id: ctx.user!.uid,
          verify_token: token,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        for (const pid of input.practitionerIds) await tx.insert('record_practitioners', { record_id: row.id, practitioner_id: pid });

        // valeurs LAB : calcul des drapeaux selon référentiel
        if (catPrefix === 'LAB' && input.values?.length) {
          const panel = await tx.findOne<Record<string, unknown>>('lab_panels', { code: String(type.type_code) });
          const params = panel
            ? await tx.find<Record<string, unknown>>('lab_parameters', { where: { panel_id: Number(panel.id) } })
            : await tx.find<Record<string, unknown>>('lab_parameters');
          const byKey = new Map<string, Record<string, unknown>>();
          for (const pm of params) byKey.set(String(pm.param_key), pm);
          const birth = patient.birth_date ? String(patient.birth_date).slice(0, 10) : null;
          const age = birth ? Math.floor((Date.now() - new Date(birth).getTime()) / 31_557_600_000) : null;
          for (const v of input.values) {
            const pm = byKey.get(v.parameterKey);
            const num = typeof v.value === 'number' ? v.value : Number(v.value);
            const isNum = Number.isFinite(num);
            let flag: 'normal' | 'low' | 'high' | 'critical' = 'normal';
            if (pm && isNum) {
              const applicable =
                (!pm.applies_sex || pm.applies_sex === patient.sex) &&
                (pm.age_min == null || (age != null && age >= Number(pm.age_min))) &&
                (pm.age_max == null || (age != null && age <= Number(pm.age_max)));
              if (applicable) flag = labFlag(num, pm as never);
            }
            await tx.insert('lab_results', {
              record_id: row.id,
              parameter_id: pm ? Number(pm.id) : null,
              param_key: v.parameterKey,
              value_num: isNum ? num : null,
              value_txt: isNum ? null : String(v.value),
              unit: v.unit ?? (pm?.unit as string) ?? null,
              ref_min: pm?.ref_min != null ? Number(pm.ref_min) : null,
              ref_max: pm?.ref_max != null ? Number(pm.ref_max) : null,
              flag,
              created_at: new Date().toISOString(),
            });
          }
        }
        await tx.insert('verify_tokens', {
          token,
          entity_type: 'medical_record',
          entity_id: row.id,
          entity_code: alloc.code,
          meta_json: { kind: 'record', category: String(cat.module), date: alloc.dateCompact },
          issued_at: new Date().toISOString(),
          expires_at: null,
          revoked: 0,
        });
        return { id: row.id, code: alloc.code, token };
      });

      ctx.resultId = out.id;
      await pushHistory(ctx.user!.uid, {
        patientId: input.patientId,
        kind: 'record',
        refId: out.id,
        refCode: out.code,
        summary: input.summary ?? ({ fr: `Fiche ${catPrefix}`, ar: `سجل ${catPrefix}` } as never),
        detail: { type: type.type_code, status: input.status },
        occurredAt: zonedDate(new Date(), env.timezone) + 'T12:00:00.000Z',
      });
      await bumpTag('records');
      return { ok: true, ...out };
    },
  });

  /** MISE À JOUR */
  route({
    method: 'PUT',
    path: '/records/:id',
    audit: { action: 'records.update', entity: 'medical_records' },
    async handler(ctx: Ctx) {
      const db = ctx.db;
      const id = Number(ctx.params.id);
      const before = await db.findOne<Record<string, unknown>>('medical_records', { id });
      if (!before) throw notFound();
      await guard(ctx, await moduleOfCategoryPrefix(String(before.category_prefix)), 'update');
      const input = await ctx.body(medicalRecordUpdateZ);
      await db.update('medical_records', id, {
        act_date: new Date(input.actDate.length <= 10 ? `${input.actDate}T12:00:00` : input.actDate).toISOString(),
        status: input.status,
        summary_json: input.summary ?? before.summary_json,
        fields_json: input.fields ?? before.fields_json,
        icd10_json: input.icd10 ?? before.icd10_json,
        location_id: input.locationId ?? null,
        appointment_id: input.apptId ?? before.appointment_id ?? null,
      });
      await db.removeWhere('record_practitioners', { record_id: id });
      for (const pid of input.practitionerIds ?? []) await db.insert('record_practitioners', { record_id: id, practitioner_id: pid });
      if (input.values) {
        await db.removeWhere('lab_results', { record_id: id });
        for (const v of input.values) {
          const num = typeof v.value === 'number' ? v.value : Number(v.value);
          await db.insert('lab_results', {
            record_id: id,
            param_key: v.parameterKey,
            value_num: Number.isFinite(num) ? num : null,
            value_txt: Number.isFinite(num) ? null : String(v.value),
            unit: v.unit ?? null,
            flag: 'normal',
            created_at: new Date().toISOString(),
          });
        }
      }
      ctx.resultId = id;
      await bumpTag('records');
      return { ok: true };
    },
  });

  /** VALIDATION (flux : validation biologique / compte rendu radiologue…) */
  route({
    method: 'POST',
    path: '/records/:id/validate',
    async handler(ctx: Ctx) {
      const db = ctx.db;
      const id = Number(ctx.params.id);
      const row = await db.findOne<Record<string, unknown>>('medical_records', { id });
      if (!row) throw notFound();
      await guard(ctx, await moduleOfCategoryPrefix(String(row.category_prefix)), 'validate');
      await db.update('medical_records', id, { status: 'validated', validated_at: new Date().toISOString(), validated_by: ctx.user!.uid });
      await pushHistory(ctx.user!.uid, { patientId: Number(row.patient_id), kind: 'record', refId: id, refCode: String(row.code), summary: { fr: 'Résultat validé', ar: 'تم التصديق على النتيجة', en: 'Result validated' }, detail: null });
      await audit({ actorId: ctx.user!.uid, action: 'records.validate', entity: 'medical_records', entityId: id, ip: ctx.ip });
      await bumpTag('records');
      return { ok: true };
    },
  });

  /** SUPPRESSION LOGIQUE */
  route({
    method: 'DELETE',
    path: '/records/:id',
    audit: { action: 'records.delete', entity: 'medical_records' },
    async handler(ctx: Ctx) {
      const db = ctx.db;
      const id = Number(ctx.params.id);
      const row = await db.findOne<Record<string, unknown>>('medical_records', { id });
      if (!row) throw notFound();
      await guard(ctx, await moduleOfCategoryPrefix(String(row.category_prefix)), 'delete');
      await db.update('medical_records', id, { archived_at: new Date().toISOString() });
      ctx.resultId = id;
      await bumpTag('records');
      return { ok: true, soft: true };
    },
  });
}

async function moduleOfCategoryPrefix(prefix: string): Promise<string> {
  const list = await categoryList();
  const found = list.find((c) => c.prefix === prefix);
  return found?.module ?? 'record.lab';
}
