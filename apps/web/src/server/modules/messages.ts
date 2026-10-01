/**
 * MESSAGERIE (§8.11) — e-mails aux patients/intervenants, modèles multilingues, pièces jointes PDF,
 * historique complet (statut, date, destinataire, erreur) + relance des échecs depuis l'admin.
 * Sans SMTP : outbox « skipped » consultable — l'application reste utilisable hors-ligne (loi 18-07 : on-premise).
 */
import { z } from 'zod';
import { route, type Ctx } from '../http/router';
import { renderTemplate, queueMail, processMail } from '../mail';
import { getDb } from '../data';
import { notFound } from '../http/errors';
import { env } from '../config';

export function registerMessages(): void {
  /** Envoi direct (modèle ou corps libre), avec pièce jointe optionnelle (asset GED/asset). */
  route({
    method: 'POST',
    path: '/messages/send',
    perm: ['message', 'create'],
    audit: { action: 'message.send', entity: 'email_messages' },
    async handler(ctx: Ctx) {
      const input = await ctx.body(
        z.object({
          to: z.string().email().max(120).optional(),
          toName: z.string().max(120).optional(),
          patientId: z.number().int().positive().optional(),
          practitionerId: z.number().int().positive().optional(),
          template: z.enum(['password_reset', 'account_activation', 'appointment_reminder', 'document_sent', 'test']).optional(),
          lang: z.enum(['ar', 'fr', 'es', 'en']).default('fr'),
          subject: z.string().max(200).optional(),
          body: z.string().max(4000).optional(),
          vars: z.record(z.union([z.string(), z.number()])).default({}),
          assetId: z.number().int().positive().optional(),
          gedCode: z.string().max(24).optional(),
        }),
      );
      const db = ctx.db;
      let to = input.to;
      let toName = input.toName;
      if (!to && input.patientId) {
        const p = await db.findOne<Record<string, unknown>>('patients', { id: input.patientId });
        if (p?.email) {
          to = String(p.email);
          toName = `${p.last_name} ${p.first_name}`;
        }
      }
      if (!to && input.practitionerId) {
        const pr = await db.findOne<Record<string, unknown>>('practitioners', { id: input.practitionerId });
        if (pr?.email) {
          to = String(pr.email);
          toName = `${pr.last_name} ${pr.first_name}`;
        }
      }
      if (!to) {
        // e-mails chiffrés : le email est en colonne enc → déjà déchiffré par hydrateRow ✓
        throw notFound();
      }
      let subject = input.subject;
      let bodyText = input.body;
      if (input.template) {
        const tpl = renderTemplate(input.template, input.lang, { ...(input.vars as Record<string, string>), url: String(input.vars.url ?? '') });
        subject = subject ?? tpl.subject;
        bodyText = bodyText ?? tpl.body;
      }
      if (!subject || !bodyText) throw new Error('sujet/corps requis (ou modèle)');
      let assetId = input.assetId;
      if (input.gedCode && !assetId) {
        const doc = await db.findOne<Record<string, unknown>>('ged_documents', { code: input.gedCode });
        if (doc) {
          const asset = await db.insert('assets', { kind: 'email-attach', file_name: String(doc.file_name), file_path: String(doc.file_path), mime: String(doc.mime), size_bytes: Number(doc.size_bytes), sha256: String(doc.sha256), patient_id: doc.patient_id ? Number(doc.patient_id) : null, uploaded_by: ctx.user!.uid, created_at: new Date().toISOString() });
          assetId = asset.id;
        }
      }
      const out = await queueMail({ to, toName, subject, bodyText, lang: input.lang, patientId: input.patientId, assetId, createdBy: ctx.user!.uid });
      return { ok: true, id: out.id, code: out.code, note: 'file SMTP — statut à suivre dans Messagerie' };
    },
  });

  /** Historique des messages envoyés (statut, destinataire, erreur, date). */
  route({
    method: 'GET',
    path: '/messages',
    perm: ['message', 'view'],
    async handler(ctx: Ctx) {
      const db = ctx.db;
      const status = ctx.query.get('status');
      const q = ctx.query.get('q');
      const where: { field: string; op: 'eq' | 'contains'; value: unknown }[] = [];
      if (status) where.push({ field: 'status', op: 'eq', value: status });
      const rows = await db.find<Record<string, unknown>>('email_messages', {
        where: where.length ? (where as never) : undefined,
        orSearch: q ? { fields: ['to_email', 'subject', 'code'], term: String(q) } : undefined,
        orderBy: [['id', 'desc']],
        limit: 200,
      });
      return { rows, outboxHint: !env.smtp.enabled ? 'SMTP non configuré — les messages restent dans la file (statut « skipped »).' : null };
    },
  });

  /** Relance manuelle (utile après configuration SMTP à chaud). */
  route({
    method: 'POST',
    path: '/messages/:id/retry',
    perm: ['message', 'create'],
    async handler(ctx: Ctx) {
      const db = ctx.db;
      const id = Number(ctx.params.id);
      const m = await db.findOne('email_messages', { id });
      if (!m) throw notFound();
      await db.update('email_messages', id, { status: 'queued', error: null });
      await processMail(id);
      const after = await db.findOne<Record<string, unknown>>('email_messages', { id });
      return { ok: true, status: after?.status };
    },
  });
}
