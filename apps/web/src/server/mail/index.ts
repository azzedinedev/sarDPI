/**
 * E-MAILS — Nodemailer (SMTP configurable) + modèles multilingues + historique en base.
 *  SANS SMTP configuré : les messages sont « skipped » dans l'OUTBOX (visible admin > Messagerie),
 *  l'application ne bloque jamais (circuit breaker : timeout de connexion court, pas de retry infini).
 *  Envoi asynchrone via la file de jobs (retry/backoff/dead-letter déjà gérés par le moteur jobs).
 */
import { getDb } from '../data';
import { env } from '../config';
import { enqueue, registerJobHandler } from '../jobs';
import { t as translate } from '../i18n/server';
import { allocateSuffixed } from '../codes/service';
import { getSection } from '../settings';

export interface OutgoingMail {
  to: string;
  toName?: string;
  subject: string;
  bodyText: string;
  lang?: string;
  patientId?: number | null;
  assetId?: number | null;
  createdBy?: number | null;
}

let transporter: import('nodemailer').Transporter | null = null;
let lastFailure = 0;

async function getTransporter() {
  const smtp = (await getSection('smtp')) as { enabled?: boolean; host?: string; port?: number; secure?: boolean; user?: string; password?: string; from?: string };
  if (!smtp.enabled || !env.smtp.enabled || !smtp.host) return null;
  // circuit breaker : si le dernier envoi a échoué il y a < 60 s, ne pas retenter (l'app reste fluide)
  if (Date.now() - lastFailure < 60_000) return null;
  if (!transporter) {
    const nodemailer = await import('nodemailer');
    transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port ?? 465,
      secure: smtp.secure ?? true,
      auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 15_000,
    });
  }
  return transporter;
}

export async function queueMail(mail: OutgoingMail): Promise<{ id: number; code: string }> {
  const db = await getDb();
  const { code } = await allocateSuffixed('message', 'MSG');
  const row = await db.insert('email_messages', {
    code,
    to_email: mail.to,
    to_name: mail.toName ?? null,
    subject: mail.subject,
    body_text: mail.bodyText,
    lang: mail.lang ?? null,
    status: 'queued',
    patient_id: mail.patientId ?? null,
    attachment_asset_id: mail.assetId ?? null,
    created_by: mail.createdBy ?? null,
  });
  await enqueue('email.send', { id: row.id });
  return { id: row.id, code };
}

export async function sendNow(mail: OutgoingMail): Promise<{ status: 'sent' | 'skipped' | 'failed'; id: number; code: string; error?: string }> {
  const { id } = await queueMail(mail);
  const db = await getDb();
  const row = await db.findOne<{ status: string; error: string | null; code?: string }>('email_messages', { id });
  // exécution inline pour les chemins critiques (lien de reset) sans attendre le worker
  await processMail(id);
  const after = await db.findOne<{ status: string; error: string | null }>('email_messages', { id });
  return { status: (after?.status as 'sent' | 'skipped' | 'failed') ?? 'queued', id, code: String(row?.code ?? ''), error: after?.error ?? undefined };
}

export async function processMail(id: number): Promise<void> {
  const db = await getDb();
  const m = await db.findOne<Record<string, unknown>>('email_messages', { id });
  if (!m || m.status === 'sent') return;
  const transport = await getTransporter();
  if (!transport) {
    await db.update('email_messages', id, { status: 'skipped' });
    return; // outbox consultable — aucun envoi réel, aucune erreur bloquante
  }
  try {
    const smtp = (await getSection('smtp')) as { from?: string };
    const assetId = m.attachment_asset_id ? Number(m.attachment_asset_id) : null;
    const attachments: { filename: string; content: Buffer; contentType?: string }[] = [];
    if (assetId) {
      const asset = await db.findOne<Record<string, unknown>>('assets', { id: assetId });
      if (asset) {
        const { readFile } = await import('../storage');
        const buf = readFile(String(asset.file_path));
        if (buf) attachments.push({ filename: String(asset.file_name), content: buf, contentType: String(asset.mime) });
      }
    }
    await transport.sendMail({
      from: smtp.from ?? env.smtp.from,
      to: `${m.to_name ? `"${String(m.to_name)}" ` : ''}<${m.to_email}>`,
      subject: String(m.subject),
      text: String(m.body_text),
      attachments,
    });
    await db.update('email_messages', id, { status: 'sent', sent_at: new Date().toISOString(), error: null });
  } catch (e) {
    lastFailure = Date.now();
    await db.update('email_messages', id, { status: 'failed', error: (e as Error).message.slice(0, 900) });
    throw e; // retry géré par le moteur jobs
  }
}

/** Modèles traduits (liens à durée limitée, rappels). */
export function renderTemplate(kind: 'password_reset' | 'account_activation' | 'appointment_reminder' | 'document_sent' | 'test', lang: string, vars: Record<string, string | number>): { subject: string; body: string } {
  const tr = (key: string) => translate(lang, 'common', key, vars);
  switch (kind) {
    case 'password_reset':
      return {
        subject: translate(lang, 'auth', 'auth.forgotTitle'),
        body: `${translate(lang, 'auth', 'auth.forgotHint')}\n\n${vars.url}\n\n${tr('pdf.confidential')}`,
      };
    case 'account_activation':
      return { subject: translate(lang, 'auth', 'auth.activateTitle'), body: `${translate(lang, 'auth', 'auth.activateTitle')}\n\n${vars.url}` };
    case 'appointment_reminder':
      return {
        subject: `${translate(lang, 'common', 'nav.calendar')} — ${vars.code}`,
        body: `${translate(lang, 'common', 'time.today')} ${vars.date} ${vars.time}\n${vars.place ?? ''}\n${vars.code}`,
      };
    case 'document_sent':
      return { subject: `${vars.docType ?? 'Document'} — ${vars.code}`, body: `${vars.url ?? ''}\n\n${tr('pdf.verifyHint')}` };
    case 'test':
    default:
      return { subject: 'sarDPI — test SMTP', body: `OK ${new Date().toISOString()}` };
  }
}

let registered = false;
export function registerMailJobs(): void {
  if (registered) return;
  registered = true;
  registerJobHandler('email.send', async (p) => {
    await processMail(Number(p.id));
  });
}
