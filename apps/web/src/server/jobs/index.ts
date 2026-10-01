/**
 * FILE DE JOBS EN BASE — SANS REDIS (§11).
 * - Dépilement : `SELECT … FOR UPDATE SKIP LOCKED` (MySQL 8+ / Postgres) → plusieurs workers PM2 sans double-consommation ;
 *   pour l'adapter JSON (démo), un claim sous verrou d'écriture mono-processus.
 * - retry exponentiel + dead-letter ; les workers démarrent une boucle unique par processus (globalThis).
 * - Handlers enregistrés par module : email.send, pdf.generate, backup.run, import.source, license.check.
 * - Écran d'administration : liste filtrable, relancer, annuler, vider les terminés.
 */
import { getDb } from '../data';
import type { DataAdapter } from '../data/types';
import { env } from '../config';
import { childLog } from '../logger';

const log = childLog('jobs');

export interface JobPayload {
  [k: string]: unknown;
}
export interface JobTask {
  kind: string;
  payload: JobPayload;
  delayMs?: number;
  maxAttempts?: number;
}
export type JobHandler = (payload: JobPayload, job: { id: number; attempts: number }) => Promise<void>;

const handlers = new Map<string, JobHandler>();
export function registerJobHandler(kind: string, fn: JobHandler): void {
  handlers.set(kind, fn);
}

export async function enqueue(kind: string, payload: JobPayload = {}, opts: { delayMs?: number; maxAttempts?: number } = {}): Promise<number> {
  const db = await getDb();
  const r = await db.insert('jobs', {
    kind,
    payload_json: payload,
    status: 'queued',
    attempts: 0,
    max_attempts: opts.maxAttempts ?? 5,
    next_run_at: new Date(Date.now() + (opts.delayMs ?? 0)).toISOString(),
  });
  return r.id;
}

const WORKER_ID = `${process.pid}-${Math.random().toString(36).slice(2, 7)}`;

async function claim(): Promise<{ id: number; kind: string; payload: JobPayload; attempts: number } | null> {
  const db = await getDb();
  if (db.demoMode) {
    // JSON : claim sous transaction (verrou global de l'adapter) — suffisant en mono-processus
    return db.transaction(async (tx) => {
      const due = await tx.find<{ id: number; kind: string; payload_json: unknown; attempts: number }>('jobs', {
        where: [
          { field: 'status', op: 'eq', value: 'queued' },
          { field: 'next_run_at', op: 'lte', value: new Date().toISOString() },
        ],
        orderBy: [['next_run_at', 'asc']],
        limit: 1,
      });
      const j = due[0];
      if (!j) return null;
      await tx.update('jobs', Number(j.id), { status: 'running', attempts: Number(j.attempts) + 1, locked_by: WORKER_ID, locked_at: new Date().toISOString() });
      return { id: Number(j.id), kind: String(j.kind), payload: (j.payload_json ?? {}) as JobPayload, attempts: Number(j.attempts) + 1 };
    });
  }
  const sql = (db as unknown as { execRaw: (s: string, p?: unknown[]) => Promise<unknown> }).execRaw.bind(db);
  const dialect = (db as unknown as { dialect?: string }).dialect;
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const pick = `SELECT id, kind, payload_json, attempts FROM jobs WHERE status = 'queued' AND next_run_at <= ${dialect === 'postgres' ? 'NOW()' : '?'} ORDER BY next_run_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`;
  const res = (await sql(pick, dialect === 'postgres' ? [] : [now])) as [{ id: number; kind: string; payload_json: unknown; attempts: number }[], unknown];
  const row = Array.isArray(res) ? res[0]?.[0] : undefined;
  if (!row) return null;
  await sql(`UPDATE jobs SET status='running', attempts=attempts+1, locked_by=?, locked_at=? WHERE id=?`, [WORKER_ID, now, row.id]);
  return { id: Number(row.id), kind: String(row.kind), payload: (typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json) as JobPayload, attempts: Number(row.attempts) + 1 };
}

async function complete(id: number, error?: string): Promise<void> {
  const db = await getDb();
  const job = await db.findOne<{ attempts: number; max_attempts: number }>('jobs', { id });
  if (!job) return;
  if (!error) {
    await db.update('jobs', id, { status: 'done', last_error: null, next_run_at: new Date().toISOString() });
    return;
  }
  const attempts = Number(job.attempts);
  const max = Number(job.max_attempts);
  const dead = attempts >= max;
  const backoffMs = Math.min(60 * 60_000, 2 ** attempts * 2_000);
  await db.update('jobs', id, {
    status: dead ? 'dead' : 'queued',
    last_error: error.slice(0, 2000),
    next_run_at: dead ? new Date().toISOString() : new Date(Date.now() + backoffMs).toISOString(),
  });
}

let started = false;
interface JobsGlobal {
  sardpiJobs?: { started: boolean; timers: NodeJS.Timeout[] };
}
const g = globalThis as unknown as JobsGlobal;

/** Démarre `env.jobWorkers` boucles de poll dans CE processus (idempotent, reloaded-safe avec pm2). */
export function startWorkers(): void {
  if (started || g.sardpiJobs?.started) {
    started = true;
    return;
  }
  started = true;
  g.sardpiJobs = { started: true, timers: [] };
  for (let i = 0; i < Math.max(1, env.jobWorkers); i++) {
    const t = setInterval(async () => {
      try {
        let job = await claim();
        while (job) {
          const handler = handlers.get(job.kind);
          try {
            if (!handler) throw new Error(`aucun handler pour le job « ${job.kind} »`);
            await handler(job.payload, { id: job.id, attempts: job.attempts });
            await complete(job.id);
          } catch (e) {
            log.warn({ jobId: job.id, kind: job.kind, err: (e as Error).message }, 'job échoué');
            await complete(job.id, (e as Error).message);
          }
          job = await claim();
        }
      } catch (e) {
        log.error({ err: (e as Error).message }, 'boucle jobs');
      }
    }, env.jobPollMs + i * 350);
    t.unref();
    g.sardpiJobs.timers.push(t);
  }
  log.info(`workers jobs démarrés (${env.jobWorkers})`);
}

export function stopWorkers(): void {
  for (const t of g.sardpiJobs?.timers ?? []) clearInterval(t);
  g.sardpiJobs = undefined;
  started = false;
}

/* ---------------- handlers de base (enregistrés par les modules au boot) ---------------- */
export async function jobStats(): Promise<Record<string, number>> {
  const db = await getDb();
  const all = await db.find<{ status: string }>('jobs');
  const out: Record<string, number> = {};
  for (const j of all) out[String(j.status)] = (out[String(j.status)] ?? 0) + 1;
  return out;
}
