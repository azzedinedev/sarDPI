/**
 * WORKFLOW DU DOSSIER (§8.3) + DÉPLACEMENTS (§8.3) — machine à états configurable (settings.workflowSteps).
 * Étapes : intervenant(s), lieu, date/heure, documents ; transition « advance » contrôlée ; kanban par étape.
 * Déplacements : transferts entre lieux avec statut/horodatage/responsable (MOV-00001).
 */
import { z } from 'zod';
import { movementZ, pickLabel } from '@sardpi/shared';
import { route, type Ctx } from '../http/router';
import { registerCrud } from '../http/crud';
import { notFound, ApiError } from '../http/errors';
import { getSection } from '../settings';
import { allocateSuffixed } from '../codes/service';
import { pushHistory } from './history';
import { getDb } from '../data';

type StepDef = { key: string; order: number; color: string; label: Record<string, string> };

async function steps(): Promise<StepDef[]> {
  const wf = (await getSection('workflowSteps')) as { steps: StepDef[] };
  return [...(wf.steps ?? [])].sort((a, b) => a.order - b.order);
}

export function registerWorkflow(): void {
  /** Dossier courant d'un patient + ses étapes (stepper/kanban). */
  route({
    method: 'GET',
    path: '/cases/current',
    perm: ['patient_case', 'view'],
    async handler(ctx: Ctx) {
      const patientId = Number(ctx.query.get('patientId'));
      if (!patientId) throw new ApiError(400, 'errors.validation', 'patientId requis');
      const db = ctx.db;
      const kase = await db.findOne<Record<string, unknown>>('patient_cases', { where: { patient_id: patientId }, orderBy: [['id', 'desc']], limit: 1 });
      const defs = await steps();
      if (!kase) return { case: null, steps: defs.map((d) => ({ ...d, status: 'todo' })) };
      const rows = await db.find<Record<string, unknown>>('case_steps', { where: { case_id: Number(kase.id) }, orderBy: [['seq', 'asc']] });
      const byKey = new Map(rows.map((r) => [String(r.step_key), r]));
      return {
        case: kase,
        steps: defs.map((d) => {
          const r = byKey.get(d.key);
          return { ...d, id: r?.id ?? null, status: r?.status ?? 'todo', planned_at: r?.planned_at ?? null, done_at: r?.done_at ?? null, location_id: r?.location_id ?? null, practitioners: parseArr(r?.practitioners_json), documents: parseArr(r?.documents_json), note: r?.note ?? null };
        }),
      };
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
      await pushHistory(ctx.user!.uid, {
        patientId: Number(kase.patient_id),
        kind: 'case',
        refId: input.caseId,
        refCode: String(kase.code),
        summary: { fr: `Étape « ${defs[idx]!.key} » ${input.status}`, ar: `خطوة ${defs[idx]!.key} : ${input.status}`, en: `Step “${defs[idx]!.key}” ${input.status}` },
        detail: { locationId: input.locationId, practitioners: input.practitionerIds },
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
      const input = await ctx.body(z.object({ patientId: z.number().int().positive(), firstStep: z.string().max(30).optional() }));
      const db = ctx.db;
      const pat = await db.findOne<Record<string, unknown>>('patients', { id: input.patientId });
      if (!pat) throw notFound();
      const open = await db.findOne<Record<string, unknown>>('patient_cases', { patient_id: input.patientId, status: 'open' });
      if (open) {
        ctx.resultId = Number(open.id);
        return { ok: true, id: Number(open.id), code: String(open.code), alreadyOpen: true };
      }
      const defs = await steps();
      const first = defs.find((d) => d.key === input.firstStep)?.key ?? defs[0]?.key;
      if (!first) throw new ApiError(500, 'errors.config', 'Aucune étape configurée (workflowSteps)');
      const code = (await allocateSuffixed('case', 'CAS')).code;
      const now = new Date().toISOString();
      const ins = await db.insert('patient_cases', { code, patient_id: input.patientId, status: 'open', current_step: first, opened_at: now, created_at: now, updated_at: now });
      const id = Number((ins as { id?: number }).id ?? 0);
      await db.insert('case_steps', { case_id: id, step_key: first, seq: defs.findIndex((d) => d.key === first) + 1, status: 'in_progress', started_at: now, created_at: now, updated_at: now });
      ctx.resultId = id;
      await pushHistory(ctx.user!.uid, { patientId: input.patientId, kind: 'case', refId: id, refCode: code, summary: { fr: 'Dossier de suivi ouvert', ar: 'تم فتح ملف المتابعة', en: 'Care record opened' }, detail: null });
      return { ok: true, id, code, alreadyOpen: false };
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
