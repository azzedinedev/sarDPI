/**
 * CALENDRIER — rendez-vous RDV-00001, détection de CONFLITS côté serveur (intervenants + lieux),
 * ressources par lieu/intervenant, week-end vendredi-samedi + option hégirienne gérés via profil pays (UI).
 */
import { z } from 'zod';
import { appointmentBaseZ, appointmentStatusZ } from '@sardpi/shared';
import { registerCrud } from '../http/crud';
import { route, type Ctx } from '../http/router';
import { allocateSuffixed } from '../codes/service';
import { getDb } from '../data';
import { ApiError, notFound } from '../http/errors';
import { pushHistory } from './history';

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

async function findConflicts(input: { practitionerId?: number | null; locationId?: number | null; startAt: string; endAt: string; ignoreId?: number }): Promise<Record<string, unknown>[]> {
  const db = await getDb();
  const start = new Date(input.startAt);
  const end = new Date(input.endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw new ApiError(400, 'errors.validation', 'horaires invalides');
  const rows = await db.find<Record<string, unknown>>('appointments', {
    where: [
      { field: 'start_at', op: 'lt', value: end.toISOString() },
      { field: 'end_at', op: 'gt', value: start.toISOString() },
    ],
    limit: 500,
  });
  return rows.filter((r) => {
    if (input.ignoreId && Number(r.id) === input.ignoreId) return false;
    if (String(r.status) === 'cancelled') return false;
    const samePract = input.practitionerId && Number(r.practitioner_id) === Number(input.practitionerId);
    const sameLoc = input.locationId && Number(r.location_id) === Number(input.locationId);
    if (!samePract && !sameLoc) return false;
    return true;
  });
}

/**
 * Sémantique PATCH : une mise à jour partielle (glisser-déposer du calendrier : startAt/endAt
 * seuls) ne doit PAS réécrire les colonnes absentes. Les `?? null` précédents écrasaient
 * praticien, lieu, type, statut et notes à chaque déplacement d'un rendez-vous.
 * À la CRÉATION, les défauts viennent du schéma Zod (kind/status/allDay) ; on ne complète
 * ici que si nécessaire. Exporté pour les tests de non-régression.
 */
/**
 * Ligne d'agenda NORMALISÉE : `kind` et `all_day` sont toujours présents côté API, quelle que soit
 * la base interrogée — installation antérieure à la migration 0002 (colonnes ajoutées, NULL sur les
 * lignes historiques), fichier JSON de démonstration d'une version précédente, ou export importé.
 * Le calendrier ne peut donc plus tomber sur un type indéfini ; le défaut reste « consultation ».
 */
export function normalizeAppointment<T extends Record<string, unknown>>(r: T): T & { kind: string; all_day: 0 | 1 } {
  const raw = r.all_day;
  const allDay = raw === true || raw === 'true' || Number(raw) === 1 ? 1 : 0;
  return { ...r, kind: r.kind ? String(r.kind) : 'consultation', all_day: allDay };
}

export function appointmentPatch(i: Record<string, unknown>, mode: 'create' | 'update'): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (i.patientId !== undefined) patch.patient_id = i.patientId;
  if (i.practitionerId !== undefined) patch.practitioner_id = i.practitionerId;
  if (i.locationId !== undefined) patch.location_id = i.locationId;
  if (i.startAt !== undefined) patch.start_at = new Date(String(i.startAt)).toISOString();
  if (i.endAt !== undefined) patch.end_at = new Date(String(i.endAt)).toISOString();
  if (i.kind !== undefined) patch.kind = i.kind;
  if (i.status !== undefined) patch.status = i.status;
  if (i.notes !== undefined) patch.notes = i.notes;
  if (i.caseId !== undefined) patch.case_id = i.caseId;
  if (i.allDay !== undefined) patch.all_day = i.allDay ? 1 : 0;
  if (mode === 'create') {
    patch.kind ??= 'consultation';
    patch.status ??= 'pending';
    patch.all_day ??= 0;
  }
  return patch;
}

export function registerAppointments(): void {
  registerCrud({
    resource: 'appointments',
    table: 'appointments',
    perm: 'appointment',
    search: ['code', 'notes'],
    defaultSort: ['start_at', 'asc'],
    bodyCreate: appointmentBaseZ,
    bodyUpdate: appointmentBaseZ.partial(),
    mapInput: async (i, _ctx, mode) => appointmentPatch(i, mode),
    allocateCode: async (tx) => (await allocateSuffixed('appointment', 'RDV', tx)).code,
    async onAfterCreate(id, row, ctx) {
      const conflicts = await findConflicts({ practitionerId: row.practitioner_id as number, locationId: row.location_id as number, startAt: String(row.start_at), endAt: String(row.end_at), ignoreId: id });
      if (conflicts.length) {
        await ctx.db.update('appointments', id, { notes: `${row.notes ?? ''}\n⚠ ${conflicts.length} conflit(s) détecté(s)`.trim() });
      }
      if (row.patient_id) await pushHistory(ctx.user!.uid, { patientId: Number(row.patient_id), kind: 'appointment', refId: id, refCode: String(row.code), summary: { fr: 'Rendez-vous programmé', ar: 'موعد مجدول', en: 'Appointment scheduled' }, detail: { at: row.start_at } });
    },
    decorate: async (rows, ctx) => {
      const db = ctx.db;
      const pats = await db.find<Record<string, unknown>>('patients', { where: { id: [...new Set(rows.map((r) => Number(r.patient_id)))] } });
      const pBy = new Map(pats.map((p) => [Number(p.id), p]));
      const prIds = [...new Set(rows.map((r) => r.practitioner_id).filter(Boolean).map(Number))];
      const prs = prIds.length ? await db.find<Record<string, unknown>>('practitioners', { where: { id: prIds } }) : [];
      const prBy = new Map(prs.map((p) => [Number(p.id), p]));
      const locIds = [...new Set(rows.map((r) => r.location_id).filter(Boolean).map(Number))];
      const locs = locIds.length ? await db.find<Record<string, unknown>>('locations', { where: { id: locIds } }) : [];
      const locBy = new Map(locs.map((l) => [Number(l.id), l]));
      return rows.map((r) =>
        normalizeAppointment({
          ...r,
          patient_name: pBy.get(Number(r.patient_id)) ? `${String(pBy.get(Number(r.patient_id))!.last_name).toUpperCase()} ${pBy.get(Number(r.patient_id))!.first_name}` : null,
          patient_code: pBy.get(Number(r.patient_id))?.code ?? null,
          practitioner_name: r.practitioner_id ? `${prBy.get(Number(r.practitioner_id))?.last_name ?? ''} ${prBy.get(Number(r.practitioner_id))?.first_name ?? ''}`.trim() : null,
          location_name: r.location_id ? locBy.get(Number(r.location_id))?.building ?? null : null,
        }),
      );
    },
    bump: ['calendar'],
  });

  /** Vue intervalle pour le calendrier (min/max bornés) + étiquettes prêtes à afficher. */
  route({
    method: 'GET',
    path: '/appointments/view',
    perm: ['appointment', 'view'],
    async handler(ctx: Ctx) {
      const from = String(ctx.query.get('from') ?? new Date(Date.now() - 7 * 86_400_000).toISOString());
      const to = String(ctx.query.get('to') ?? new Date(Date.now() + 30 * 86_400_000).toISOString());
      const practitionerId = ctx.query.get('practitionerId');
      const locationId = ctx.query.get('locationId');
      const patientId = ctx.query.get('patientId');
      const where: { field: string; op: 'gte' | 'lte' | 'eq'; value: unknown }[] = [
        { field: 'start_at', op: 'gte', value: from },
        { field: 'start_at', op: 'lte', value: to },
      ];
      if (practitionerId) where.push({ field: 'practitioner_id', op: 'eq', value: Number(practitionerId) });
      if (locationId) where.push({ field: 'location_id', op: 'eq', value: Number(locationId) });
      if (patientId) where.push({ field: 'patient_id', op: 'eq', value: Number(patientId) });
      const rows = await ctx.db.find<Record<string, unknown>>('appointments', { where: where as never, orderBy: [['start_at', 'asc']], limit: 800 });
      // la vue alimente DIRECTEMENT le calendrier : kind/all_day doivent y être garantis aussi
      return { rows: rows.map(normalizeAppointment) };
    },
  });

  /** Création par glisser-déposer : check conflit avant enregistrement (l'UI affiche l'avertissement). */
  route({
    method: 'POST',
    path: '/appointments/conflicts',
    perm: ['appointment', 'view'],
    async handler(ctx: Ctx) {
      const input = await ctx.body(
        z.object({ practitionerId: z.number().int().nullable().optional(), locationId: z.number().int().nullable().optional(), startAt: z.string(), endAt: z.string(), ignoreId: z.number().int().optional() }),
      );
      const conflicts = await findConflicts(input);
      return { conflicts: conflicts.map((c) => ({ id: c.id, code: c.code, startAt: c.start_at, endAt: c.end_at, patientId: c.patient_id })) };
    },
  });

  /**
   * Statuts (confirmation/annulation/venu) depuis le calendrier. Le statut suit le réglage
   * admin « calendarKinds » : clé libre bornée + alias historiques normalisés (scheduled → pending…),
   * pour ne jamais répondre 422 sur un rendez-vous existant.
   */
  route({
    method: 'POST',
    path: '/appointments/:id/status',
    perm: ['appointment', 'update'],
    async handler(ctx: Ctx) {
      const input = await ctx.body(z.object({ status: appointmentStatusZ }));
      const db = ctx.db;
      const id = Number(ctx.params.id);
      const row = await db.findOne<Record<string, unknown>>('appointments', { id });
      if (!row) throw notFound();
      await db.update('appointments', id, { status: input.status });
      return { ok: true };
    },
  });
}
