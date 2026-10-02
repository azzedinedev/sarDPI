/**
 * MODULE ORDONNANCES (§8.5) — éditeur visuel + contrôle interactions/allergies (avertissements non bloquants),
 * code combiné {ORD}-{AAAAMMJJ}-{SEQ}-{PAT}, template, QR de vérification, rendu PDF via gabarit partagé avec la page d'impression.
 * Médicaments : recherche DCI + nom commercial (nomenclature importable, drapeau remboursement).
 */
import { z } from 'zod';
import { rxCreateZ, rxTemplateZ } from '@sardpi/shared';
import { route, type Ctx } from '../http/router';
import { registerCrud } from '../http/crud';
import { ApiError, notFound } from '../http/errors';
import { allocateRecordCode } from '../codes/service';
import { publicToken } from '../util';
import { pushHistory } from './history';
import { sanitizeRow } from '../http/crud';
import { getDb } from '../data';
import { bumpTag } from '../cache';

/** Contrôle allergie + interaction pour une ligne de prescription (ATC classes). */
async function checkRx(patientId: number, lines: { dci?: string | null; tradeName: string; drugId?: number | null }[]): Promise<{ warnings: { kind: 'allergy' | 'interaction'; text: string; refs: string[] }[] }> {
  const db = await getDb();
  const patient = await db.findOne<Record<string, unknown>>('patients', { id: patientId });
  const warnings: { kind: 'allergy' | 'interaction'; text: string; refs: string[] }[] = [];
  const allergies: string[] = Array.isArray(patient?.allergies_json) ? (patient!.allergies_json as string[]) : patient?.allergies_json ? JSON.parse(String(patient.allergies_json)) : [];
  const drugIds = lines.map((l) => l.drugId).filter(Boolean) as number[];
  const drugs = drugIds.length ? await db.find<Record<string, unknown>>('drugs', { where: { id: drugIds } }) : [];
  const byId = new Map(drugs.map((d) => [Number(d.id), d]));
  const atcs: string[] = [];
  for (const l of lines) {
    const d = l.drugId ? byId.get(l.drugId) : await db.findOne<Record<string, unknown>>('drugs', { trade_name: l.tradeName });
    if (!d) continue;
    const dci = String(d.dci ?? l.dci ?? '').toLowerCase();
    const trade = String(d.trade_name ?? '').toLowerCase();
    for (const a of allergies) {
      const aa = a.toLowerCase();
      if (dci && (dci.includes(aa) || aa.includes(dci))) warnings.push({ kind: 'allergy', text: `${a} ↔ ${d.trade_name}`, refs: [String(d.trade_name)] });
      else if (trade.includes(aa)) warnings.push({ kind: 'allergy', text: `${a} ↔ ${d.trade_name}`, refs: [String(d.trade_name)] });
    }
    if (d.atc) atcs.push(String(d.atc).slice(0, 4));
  }
  if (atcs.length > 1) {
    const db2 = await getDb();
    const inter = await db2.find<Record<string, unknown>>('drug_interactions', { limit: 5000 });
    const set = new Set(atcs);
    for (const i of inter) {
      if (set.has(String(i.a_atc)) && set.has(String(i.b_atc))) {
        warnings.push({ kind: 'interaction', text: `${i.a_atc} ↔ ${i.b_atc} (${String(i.severity ?? '')})`, refs: [] });
      }
    }
  }
  // dédoublonnage
  const seen = new Set<string>();
  return { warnings: warnings.filter((w) => (seen.has(w.text) ? false : (seen.add(w.text), true))) };
}

export function registerPrescriptions(): void {
  /** Création d'ordonnance (lignes + code + QR) — atomique. */
  route({
    method: 'POST',
    path: '/prescriptions',
    perm: ['prescription', 'create'],
    audit: { action: 'rx.create', entity: 'prescriptions' },
    async handler(ctx: Ctx) {
      const input = await ctx.body(rxCreateZ);
      const db = ctx.db;
      const patient = await db.findOne<Record<string, unknown>>('patients', { id: input.patientId });
      if (!patient) throw new ApiError(400, 'errors.validation', 'patient introuvable', { patientId: true });
      const out = await db.transaction(async (tx) => {
        const alloc = await allocateRecordCode(String(patient.code), input.patientId, 'ORD', input.actDate, tx);
        const token = publicToken();
        const rx = await tx.insert('prescriptions', {
          code: alloc.code,
          patient_id: input.patientId,
          practitioner_id: input.practitionerId,
          act_date: new Date(input.actDate.length <= 10 ? `${input.actDate}T12:00:00` : input.actDate).toISOString(),
          status: 'draft',
          template_id: input.templateId ?? null,
          locale: input.locale ?? null,
          notes: input.notes ?? null,
          refills: input.refills ?? 0,
          verify_token: token,
        });
        let seq = 0;
        for (const line of input.lines) {
          seq++;
          let reimbursable: null | number = null;
          if (line.drugId) {
            const d = await tx.findOne<Record<string, unknown>>('drugs', { id: line.drugId });
            if (d) reimbursable = Number(d.reimbursable) ? 1 : 0;
          }
          await tx.insert('prescription_lines', {
            prescription_id: rx.id,
            seq,
            drug_id: line.drugId ?? null,
            dci: line.dci ?? null,
            trade_name: line.tradeName,
            form: line.form ?? null,
            dosage: line.dosage ?? null,
            quantity: line.quantity,
            posology: line.posology,
            duration_days: line.durationDays,
            instructions: line.instructions ?? null,
            reimbursable,
          });
        }
        await tx.insert('verify_tokens', {
          token,
          entity_type: 'prescription',
          entity_id: rx.id,
          entity_code: alloc.code,
          meta_json: { kind: 'rx', date: alloc.dateCompact },
          issued_at: new Date().toISOString(),
          expires_at: null,
          revoked: 0,
        });
        return { id: rx.id, code: alloc.code, token };
      });
      ctx.resultId = out.id;
      const checks = await checkRx(input.patientId, input.lines);
      await pushHistory(ctx.user!.uid, {
        patientId: input.patientId,
        kind: 'rx',
        refId: out.id,
        refCode: out.code,
        summary: { fr: `Ordonnance émise (${input.lines.length} ligne(s))`, ar: `وصفة (${input.lines.length} بند)`, en: `Prescription issued (${input.lines.length} lines)` },
        detail: { warnings: checks.warnings.length },
      });
      await bumpTag('rx');
      return { ok: true, ...out, checks };
    },
  });

  /** Aperçu des contrôles (allergies + interactions) avant enregistrement — avertissements, jamais bloquant. */
  route({
    method: 'POST',
    path: '/prescriptions/check',
    perm: ['prescription', 'create'],
    async handler(ctx: Ctx) {
      const input = await ctx.body(z.object({ patientId: z.number().int().positive(), lines: z.array(z.object({ drugId: z.number().int().optional().nullable(), dci: z.string().max(80).optional().nullable(), tradeName: z.string().max(80) })).max(30) }));
      return await checkRx(input.patientId, input.lines);
    },
  });

  /** Détail + lignes. */
  route({
    method: 'GET',
    path: '/prescriptions/:id',
    perm: ['prescription', 'view'],
    async handler(ctx: Ctx) {
      const db = ctx.db;
      const row = await db.findOne<Record<string, unknown>>('prescriptions', { id: Number(ctx.params.id) });
      if (!row) throw notFound();
      const lines = await db.find<Record<string, unknown>>('prescription_lines', { where: { prescription_id: Number(row.id) }, orderBy: [['seq', 'asc']] });
      const patient = await db.findOne<Record<string, unknown>>('patients', { id: Number(row.patient_id) });
      const pract = await db.findOne<Record<string, unknown>>('practitioners', { id: Number(row.practitioner_id) });
      return { ...sanitizeRow(row), lines, patient: patient ? { code: patient.code, last_name: patient.last_name, first_name: patient.first_name, birth_date: patient.birth_date, sex: patient.sex } : null, practitioner: pract ? { code: pract.code, name: `${pract.last_name} ${pract.first_name}`, order_number: pract.order_number } : null };
    },
  });

  /** Validation (statut) — après relecture. */
  route({
    method: 'POST',
    path: '/prescriptions/:id/validate',
    perm: ['prescription', 'validate'],
    audit: { action: 'rx.validate', entity: 'prescriptions' },
    async handler(ctx: Ctx) {
      const db = ctx.db;
      const row = await db.findOne<Record<string, unknown>>('prescriptions', { id: Number(ctx.params.id) });
      if (!row) throw notFound();
      await db.update('prescriptions', Number(row.id), { status: 'validated' });
      ctx.resultId = Number(row.id);
      return { ok: true };
    },
  });

  /** Suppression logique via CRUD général (soft delete, code jamais réutilisé). */
  registerCrud({
    resource: 'prescriptions',
    table: 'prescriptions',
    perm: 'prescription',
    softDelete: true,
    search: ['code'],
    defaultSort: ['id', 'desc'],
    bodyCreate: z.object({}), // POST/PUT sur /prescriptions passent par les handlers dédiés ci-dessus
    bodyUpdate: z.object({ status: z.string().max(16).optional(), notes: z.string().max(1000).optional().nullable(), refills: z.number().int().min(0).max(12).optional() }),
    mapInput: async (i, _ctx, mode) => {
      if (mode === 'create') throw new ApiError(405, 'errors.validation', 'POST /prescriptions (dédié, avec lignes) requis');
      const out: Record<string, unknown> = {};
      if (i.status) out.status = i.status;
      if (i.notes !== undefined) out.notes = i.notes;
      if (i.refills !== undefined) out.refills = i.refills;
      return out;
    },
    baseWhere: (ctx) => (ctx.query.get('patientId') ? [{ field: 'patient_id', op: 'eq' as const, value: Number(ctx.query.get('patientId')) }] : []),
    decorate: async (rows, ctx) => {
      const db = ctx.db;
      const ids = rows.map((r) => Number(r.id));
      const lines = ids.length ? await db.find<Record<string, unknown>>('prescription_lines', { where: { prescription_id: ids }, limit: 4000 }) : [];
      const pats = rows.length ? await db.find<Record<string, unknown>>('patients', { where: { id: [...new Set(rows.map((r) => Number(r.patient_id)))] } }) : [];
      const pBy = new Map(pats.map((p) => [Number(p.id), p]));
      return rows.map((r) => ({
        ...r,
        line_count: lines.filter((l) => Number(l.prescription_id) === Number(r.id)).length,
        patient_code: pBy.get(Number(r.patient_id))?.code ?? null,
        patient_name: pBy.get(Number(r.patient_id)) ? `${String(pBy.get(Number(r.patient_id))!.last_name).toUpperCase()} ${pBy.get(Number(r.patient_id))!.first_name}` : null,
      }));
    },
    bump: ['rx'],
  });

  /** Recherche médicaments (DCI + nom commercial) — sélecteur de l'éditeur. */
  route({
    method: 'GET',
    path: '/drugs/search',
    perm: ['drug', 'view'],
    cacheable: false,
    async handler(ctx: Ctx) {
      const q = String(ctx.query.get('q') ?? '').trim();
      const db = ctx.db;
      let rows: Record<string, unknown>[] = [];
      if (q) {
        rows = await db.find<Record<string, unknown>>('drugs', { where: [{ field: 'trade_name', op: 'contains', value: q }, { field: 'dci', op: 'contains', value: q }], limit: 30, combinator: 'OR' });
      } else {
        rows = await db.find<Record<string, unknown>>('drugs', { where: { reimbursable: 1 }, limit: 20, orderBy: [['trade_name', 'asc']] });
      }
      return {
        rows: rows.map((d) => ({
          id: d.id,
          code: d.code,
          tradeName: d.trade_name,
          dci: d.dci,
          form: d.form,
          dosage: d.dosage,
          pack: d.pack,
          reimbursable: Boolean(Number(d.reimbursable)),
          refundRate: d.refund_rate != null ? Number(d.refund_rate) : null,
          priceDzd: d.price_dzd != null ? Number(d.price_dzd) : null,
          atc: d.atc,
        })),
      };
    },
  });

  /** Templates d'ordonnance (constructeur) — CRUD + définition du template par défaut. */
  registerCrud({
    resource: 'rx-templates',
    table: 'prescription_templates',
    perm: 'prescription',
    search: ['name', 'code'],
    defaultSort: ['id', 'asc'],
    bodyCreate: rxTemplateZ,
    bodyUpdate: rxTemplateZ.partial(),
    mapInput: async (i) => ({ name: i.name, config_json: i, is_default: 0 }),
    allocateCode: async (tx) => {
        const m = await import('../codes/service');
        const r = await m.allocateSuffixed('template', 'TPL', tx);
        return r.code;
      },
    bump: ['rx'],
  });

  route({
    method: 'POST',
    path: '/rx-templates/:id/default',
    perm: ['prescription', 'update'],
    async handler(ctx: Ctx) {
      const db = ctx.db;
      const id = Number(ctx.params.id);
      if (!(await db.findOne('prescription_templates', { id }))) throw notFound();
      const all = await db.find<Record<string, unknown>>('prescription_templates');
      for (const t of all) await db.update('prescription_templates', Number(t.id), { is_default: Number(t.id) === id ? 1 : 0 });
      return { ok: true };
    },
  });
}
