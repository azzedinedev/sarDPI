/**
 * MODULE PATIENTS — fiche complète + historique 2 niveaux + droit d'accès (loi 18-07).
 * Le code PAT-00001 est généré SERVEUR (transaction + verrou) ; la suppression est logique ;
 * les champs sensibles (tél, email, NIN, Chifa) sont chiffrés au repos (AES-GCM si ENC_KEYS présent).
 */
import { z } from 'zod';
import { patientCreateZ, ageFromBirth, pickLabel, sanitizeRichHtml, type RefItem } from '@sardpi/shared';
import { route, type Ctx } from '../http/router';
import { registerCrud, sanitizeRow } from '../http/crud';
import { allocatePatientCode, peekPatientCode } from '../codes/service';
import { getDb } from '../data';
import { ApiError, notFound } from '../http/errors';
import { cached } from '../cache';
import { zonedDate } from '../util';
import { env } from '../config';
import { pushHistory } from './history';
import { barcodeSvg, qrSvg, verifyUrl } from '../qr';
import { publicToken } from '../util';

/** Chaîne riche (allergies/antécédents/notes) : sanitize ; tableau legacy : conservé tel quel (rétrocompatible). */
function richField(v: unknown): unknown {
  if (typeof v === 'string') { const h = sanitizeRichHtml(v); return h || []; }
  return v ?? [];
}

export function mapPatientInput(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    first_name: input.firstName,
    last_name: input.lastName,
    first_name_ar: input.firstNameAr ?? null,
    last_name_ar: input.lastNameAr ?? null,
    birth_date: input.birthDate ?? null,
    sex: input.sex,
    wilaya_code: input.wilayaCode ?? null,
    daira: input.daira ?? null,
    commune: input.commune ?? null,
    address: input.address ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    nin: input.nin ?? null,
    ss_fund: input.ssFund ?? null,
    ss_number: input.ssNumber ?? null,
    chifa_number: input.chifaNumber ?? null,
    having_right: input.havingRight ? 1 : 0,
    third_party_payer: input.thirdPartyPayer ? 1 : 0,
    emergency_name: input.emergencyName ?? null,
    emergency_phone: input.emergencyPhone ?? null,
    emergency_relation: input.emergencyRelation ?? null,
    blood_group: input.bloodGroup ?? null,
    // champs riches « antécédents »/« allergies » : HTML assaini ou liste legacy
    allergies_json: richField(input.allergies),
    antecedents_json: richField(input.antecedents),
    attending_practitioner_id: input.attendingPractitionerId ?? null,
    preferred_locale: input.preferredLocale ?? 'fr',
    country: input.country ?? 'DZ',
    notes: typeof input.notes === 'string' && input.notes.trim() ? sanitizeRichHtml(input.notes) || null : (input.notes ?? null),
    consent_json: input.consent ?? { granted: false, scopes: [] },
  };
  return out;
}

async function wilayasMap(): Promise<Map<number, { fr: string; ar: string }>> {
  return cached('refs', 'wilayas', 300_000, async () => {
    const db = await getDb();
    const rows = await db.find<Record<string, unknown>>('admin_regions', { where: { kind: 'wilaya' } });
    return new Map(rows.map((r) => [Number(r.code_str), { fr: String(r.name_fr ?? ''), ar: String(r.name_ar ?? '') }]));
  });
}

export async function decoratePatients(rows: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  const db = await getDb();
  const wilayas = await wilayasMap();
  const attendingIds = [...new Set(rows.map((r) => r.attending_practitioner_id).filter(Boolean).map(Number))];
  const practs = attendingIds.length ? await db.find<Record<string, unknown>>('practitioners', { where: { id: attendingIds } }) : [];
  const practById = new Map(practs.map((p) => [Number(p.id), p]));
  return rows.map((r) => {
    const w = r.wilaya_code != null ? wilayas.get(Number(r.wilaya_code)) : undefined;
    const attending = r.attending_practitioner_id ? practById.get(Number(r.attending_practitioner_id)) : undefined;
    return {
      ...r,
      age: ageFromBirth(r.birth_date ? String(r.birth_date).slice(0, 10) : null),
      wilaya_label: w ? `${Number(r.wilaya_code)}. ${w.fr}` : null,
      wilaya_label_ar: w ? `${Number(r.wilaya_code)}. ${w.ar}` : null,
      attending_name: attending ? `${attending.last_name} ${attending.first_name}` : null,
      full_name: `${String(r.last_name ?? '').toUpperCase()} ${r.first_name ?? ''}`,
      full_name_ar: r.last_name_ar ? `${r.first_name_ar ?? ''} ${r.last_name_ar}` : null,
    };
  });
}

export function registerPatients(): void {
  registerCrud({
    resource: 'patients',
    table: 'patients',
    perm: 'patient',
    softDelete: true,
    search: ['code', 'first_name', 'last_name', 'first_name_ar', 'last_name_ar', 'ss_number', 'emergency_phone'],
    defaultSort: ['updated_at', 'desc'],
    bodyCreate: patientCreateZ,
    bodyUpdate: patientCreateZ.partial(),
    mapInput: async (input) => {
      const out = mapPatientInput(input);
      // Groupes sanguins & caisses SS : listes CONFIGURABLES (Réglages › Référentiels médicaux) — valeur hors liste ⇒ 422 (hors rétrocompatibilité des codes déjà stockés).
      const { getSection } = await import('../settings');
      const refs = (await getSection('medicalRefs')) as { bloodGroups: RefItem[]; ssFunds: RefItem[] };
      const known = (items: RefItem[] | undefined, v: unknown): boolean => v == null || v === '' || (items ?? []).some((x) => x.code === v || x.active === false);
      if (!known(refs.bloodGroups, out.blood_group)) throw new ApiError(422, 'errors.validation', 'blood_group', { bloodGroup: `inconnu: ${String(out.blood_group)}` });
      if (!known(refs.ssFunds, out.ss_fund)) throw new ApiError(422, 'errors.validation', 'ss_fund', { ssFund: `inconnu: ${String(out.ss_fund)}` });
      return out;
    },
    allocateCode: async (tx) => (await allocatePatientCode(tx)).code,
    decorate: async (rows) => decoratePatients(rows as Record<string, unknown>[]) as never,
    bump: ['refs'],
    async onAfterCreate(id, row, ctx) {
      const db = await getDb();
      await pushHistory(ctx.user?.uid ?? null, {
        patientId: id,
        kind: 'profile',
        refCode: String(row.code ?? ''),
        summary: { fr: 'Dossier créé', ar: 'تم إنشاء الملف', en: 'Record created' },
        detail: { code: row.code },
      });
      // ouvre automatiquement le circuit du dossier à l'étape « Accueil » (CAS-00001, code serveur sous verrou)
      await db.transaction(async (tx) => {
        const { allocateSuffixed } = await import('../codes/service');
        const { code } = await allocateSuffixed('case', 'CAS', tx);
        const cas = await tx.insert('patient_cases', {
          code,
          patient_id: id,
          title: null,
          current_step: 'admission',
          status: 'open',
          opened_at: new Date().toISOString(),
        });
        const { getSection } = await import('../settings');
        const wf = (await getSection('workflowSteps')) as { steps?: { key: string; order: number }[] };
        const steps = (wf.steps ?? []).slice().sort((a, b) => a.order - b.order);
        for (const s of steps) {
          await tx.insert('case_steps', { case_id: cas.id, step_key: s.key, seq: s.order, status: s.key === 'admission' ? 'in_progress' : 'todo', updated_at: new Date().toISOString() });
        }
      });
    },
    async onAfterUpdate(id, before, after, ctx) {
      await pushHistory(ctx.user?.uid ?? null, {
        patientId: id,
        kind: 'profile',
        refCode: String(after.code ?? ''),
        summary: { fr: 'Fiche mise à jour', ar: 'تم تحديث البطاقة', en: 'Record updated' },
        detail: null,
      });
    },
  });

  /** Aperçu du prochain code (UI « création », sans allocation réelle — purement informatif). */
  route({ method: 'GET', path: '/patients/meta/next-code', perm: ['patient', 'create'], handler: async () => ({ nextCode: await peekPatientCode() }) });

  /** Recherche par code scanné (QR / code-barres) — renvoie le résumé minimal, LTR forcé. */
  route({
    method: 'GET',
    path: '/patients/search',
    perm: ['patient', 'view'],
    async handler(ctx: Ctx) {
      const q = String(ctx.query.get('code') ?? '').trim().toUpperCase();
      if (!q) return { rows: [] };
      const db = ctx.db;
      const direct = await db.findOne<Record<string, unknown>>('patients', { code: q });
      if (direct) {
        const [d] = await decoratePatients([direct]);
        return { rows: [sanitizeRow(d!)] };
      }
      const rows = await db.find<Record<string, unknown>>('patients', { where: [{ field: 'code', op: 'contains', value: q }], limit: 20 });
      return { rows: (await decoratePatients(rows)).map(sanitizeRow) };
    },
  });

  /** Historique 2 niveaux : réduit (timeline) / détaillé (contenus + pièces jointes). */
  route({
    method: 'GET',
    path: '/patients/:id/history',
    perm: ['patient', 'view'],
    async handler(ctx: Ctx) {
      const id = Number(ctx.params.id);
      const db = ctx.db;
      const patient = await db.findOne('patients', { id });
      if (!patient) throw notFound();
      const mode = ctx.query.get('mode') === 'detailed' ? 'detailed' : 'reduced';
      const limit = mode === 'reduced' ? 120 : 500;
      const rows = await db.find<Record<string, unknown>>('history_events', { where: { patient_id: id }, orderBy: [['occurred_at', 'desc'], ['id', 'desc']], limit });
      if (mode === 'reduced') {
        return {
          mode,
          rows: rows.map((r) => ({
            id: Number(r.id),
            kind: r.kind,
            at: r.occurred_at,
            ref_code: r.ref_code,
            summary: typeof r.summary_json === 'string' ? JSON.parse(String(r.summary_json)) : r.summary_json,
          })),
        };
      }
      return { mode, rows: rows.map((r) => sanitizeRow(r)) };
    },
  });

  /** Note libre dans l'historique (infirmier/secrétariat…). */
  route({
    method: 'POST',
    path: '/patients/:id/notes',
    perm: ['patient', 'update'],
    async handler(ctx: Ctx) {
      const id = Number(ctx.params.id);
      const db = ctx.db;
      if (!(await db.findOne('patients', { id }))) throw notFound();
      const input = await ctx.body(z.object({ text: z.string().min(2).max(2000), lang: z.string().length(2).default('fr') }));
      await pushHistory(ctx.user?.uid ?? null, { patientId: id, kind: 'note', summary: { [input.lang]: input.text }, detail: null });
      return { ok: true };
    },
  });

  /** Consentement (loi 18-07) : trace dédiée + historique. */
  route({
    method: 'POST',
    path: '/patients/:id/consent',
    perm: ['patient', 'update'],
    async handler(ctx: Ctx) {
      const id = Number(ctx.params.id);
      const input = await ctx.body(z.object({ granted: z.boolean(), scopes: z.array(z.string().max(30)).max(10).default(['care', 'documents']) }));
      const db = ctx.db;
      const p = await db.findOne<Record<string, unknown>>('patients', { id });
      if (!p) throw notFound();
      const consent = { granted: input.granted, grantedAt: input.granted ? new Date().toISOString() : null, scopes: input.scopes, revokedAt: input.granted ? null : new Date().toISOString() };
      await db.update('patients', id, { consent_json: consent });
      await pushHistory(ctx.user?.uid ?? null, {
        patientId: id,
        kind: 'consent',
        summary: input.granted ? { fr: 'Consentement accordé', ar: 'تم منح الرضا', en: 'Consent granted' } : { fr: 'Consentement retiré', ar: 'تم سحب الرضا', en: 'Consent revoked' },
        detail: { scopes: input.scopes },
      });
      return { ok: true, consent };
    },
  });

  /** Droit d'accès / portabilité (18-07) : export JSON complet de ce patient uniquement. */
  route({
    method: 'GET',
    path: '/patients/:id/export',
    perm: ['patient', 'export'],
    async handler(ctx: Ctx) {
      const id = Number(ctx.params.id);
      const db = ctx.db;
      const patient = await db.findOne('patients', { id });
      if (!patient) throw notFound();
      const [records, rx, ged, appts, movements, history] = await Promise.all([
        db.find('medical_records', { where: { patient_id: id }, limit: 1000 }),
        db.find('prescriptions', { where: { patient_id: id }, limit: 500 }),
        db.find('ged_documents', { where: { patient_id: id }, limit: 1000 }),
        db.find('appointments', { where: { patient_id: id }, limit: 500 }),
        db.find('patient_movements', { where: { patient_id: id }, limit: 500 }),
        db.find('history_events', { where: { patient_id: id }, limit: 1000 }),
      ]);
      const payload = {
        exportedAt: new Date().toISOString(),
        basis: 'Loi 18-07 (Algérie) — droit d’accès / copy of record',
        patient: sanitizeRow(patient),
        records: records.map(sanitizeRow),
        prescriptions: rx.map(sanitizeRow),
        documents: ged.map(sanitizeRow),
        appointments: appts.map(sanitizeRow),
        movements: movements.map(sanitizeRow),
        history: history.map(sanitizeRow),
      };
      return new Response(JSON.stringify(payload, null, 2), {
        headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="export-${patient.code}.json"` },
      });
    },
  });

  /** Badge patient : QR (lien de vérification interne) + code-barres Code128, rendus serveur pour PDF/impression. */
  route({
    method: 'GET',
    path: '/patients/:id/badge-assets',
    perm: ['patient', 'print'],
    async handler(ctx: Ctx) {
      const id = Number(ctx.params.id);
      const db = ctx.db;
      const p = await db.findOne<Record<string, unknown>>('patients', { id });
      if (!p) throw notFound();
      const code = String(p.code);
      // jeton de vérification propre au patient (aucune donnée affichée via ce jeton, juste l'authenticité)
      let vt = await db.findOne<Record<string, unknown>>('verify_tokens', { entity_type: 'patient', entity_id: id });
      if (!vt) {
        const token = publicToken();
        await db.insert('verify_tokens', { token, entity_type: 'patient', entity_id: id, entity_code: code, meta_json: { kind: 'patient' }, issued_at: new Date().toISOString(), expires_at: null, revoked: 0 });
        vt = { token };
      }
      const url = verifyUrl(env.appUrl, String(vt!.token));
      const [qr, bar] = await Promise.all([qrSvg(url, { size: 128 }), barcodeSvg(code)]);
      return { qr, barcode: bar, url, code, name: pickLabel({ fr: `${p.last_name} ${p.first_name}`, ar: [p.first_name_ar, p.last_name_ar].filter(Boolean).join(' ') || undefined }, ctx.user?.locale ?? 'fr') };
    },
  });
}

export { zonedDate };
