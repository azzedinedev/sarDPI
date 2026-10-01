/**
 * BOOT serveur : enregistrement des routes API (une seule fois, globalThis-safe pour le hot-reload dev),
 * handlers de jobs, workers (file en base sans Redis), arrêt gracieux (SIGTERM).
 */
import { assertBootConfig } from './config';
import { createLogger } from './logger';

const log = createLogger();

let booted = false;

export async function boot(): Promise<void> {
  if (booted) return;
  booted = true;
  assertBootConfig();

  /* ------------------------------------------------------------- routes */
  const { registerRoutes } = await import('./routes');
  await registerRoutes();

  /* -------------------------------------------------------- job handlers */
  const { registerJobHandler, startWorkers } = await import('./jobs');
  const { registerMailJobs } = await import('./mail');
  registerMailJobs();

  registerJobHandler('backup.run', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { paths } = await import('./config');
    const { getDb } = await import('./data');
    const { TABLES } = await import('./data/schema');
    const db = await getDb();
    fs.mkdirSync(paths.backups, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const out: Record<string, unknown> = {};
    for (const t of TABLES) {
      const rows = await db.find(t.name, { limit: 100_000 });
      out[t.name] = { auto: rows.reduce((m, r) => Math.max(m, Number(r.id ?? 0)), 0), rows };
    }
    fs.writeFileSync(path.join(paths.backups, `sardpi-backup-${stamp}.json.gz`), (await import('node:zlib')).gzipSync(JSON.stringify(out)));
    // rétention
    const bk = (await (await import('./settings')).getSection('backups')) as unknown as { retentionDays: number };
    const files = fs.readdirSync(paths.backups).filter((f) => f.startsWith('sardpi-backup-')).sort();
    const maxAge = Date.now() - Math.max(1, bk.retentionDays ?? 30) * 86_400_000;
    for (const f of files) {
      try {
        if (fs.statSync(path.join(paths.backups, f)).mtimeMs < maxAge) fs.rmSync(path.join(paths.backups, f));
      } catch {
        /* noop */
      }
    }
    log.info({ backup: `sardpi-backup-${stamp}.json.gz` }, 'sauvegarde créée');
  });

  registerJobHandler('import.source', async (payload) => {
    const { getDb } = await import('./data');
    const db = await getDb();
    const source = await db.findOne<Record<string, unknown>>('external_sources', { id: Number(payload.sourceId) });
    if (!source) throw new Error('source inconnue');
    const run = await db.insert('import_runs', { source_id: Number(source.id), kind: 'rows', status: 'running', started_at: new Date().toISOString(), rows_in: 0, rows_out: 0 });
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      const res = await fetch(String(source.base_url), { signal: controller.signal, headers: { accept: 'application/json' } });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as unknown;
      const rows = Array.isArray(json) ? json : Array.isArray((json as { data?: unknown[] }).data) ? (json as { data: unknown[] }).data : [];
      const mapping = (typeof source.mapping_json === 'string' ? JSON.parse(String(source.mapping_json)) : source.mapping_json) as Record<string, string>;
      let out = 0;
      for (const row of rows.slice(0, Number(payload.limit ?? 200))) {
        const src = row as Record<string, unknown>;
        const target: Record<string, unknown> = {};
        for (const [from, to] of Object.entries(mapping ?? {})) if (src[from] !== undefined) target[to] = src[from];
        if (!target.dci || !target.trade_name) continue;
        const dup = await db.findOne('drugs', { trade_name: String(target.trade_name) });
        if (dup) continue;
        await db.insert('drugs', {
          code: `DRG-IMP-${Date.now()}-${out}`,
          dci: String(target.dci).slice(0, 80),
          trade_name: String(target.trade_name).slice(0, 80),
          form: target.form ? String(target.form) : null,
          dosage: target.dosage ? String(target.dosage) : null,
          reimbursable: target.reimbursable !== undefined ? (target.reimbursable ? 1 : 0) : 1,
          price_dzd: target.price_dzd != null && !Number.isNaN(Number(target.price_dzd)) ? Number(target.price_dzd) : null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        out++;
      }
      await db.update('import_runs', run.id, { status: 'done', rows_in: rows.length, rows_out: out, finished_at: new Date().toISOString() });
      const { bumpTag } = await import('./cache');
      await bumpTag('refs');
    } catch (e) {
      await db.update('import_runs', run.id, { status: 'failed', error: (e as Error).message, finished_at: new Date().toISOString() });
      throw e;
    }
  });

  registerJobHandler('license.check', async () => {
    // contrôle planifié : fait basculer state en 'expired' à la date butoir (sans aucun appel externe)
    const { getSection, saveSection } = await import('./settings');
    const lic = (await getSection('license')) as { state: string; expiresAt?: string; key?: string; maxUsers?: number };
    if (lic.state === 'valid' && lic.expiresAt && new Date(lic.expiresAt) < new Date()) {
      await saveSection('license', { ...lic, state: 'expired' });
      log.warn('licence expirée — fonctionnalités administrables verrouillées');
    }
  });

  startWorkers();

  // arrêt gracieux : on coupe les workers, le serveur finit ses requêtes (Next/pm2 gère le reste)
  const shutdown = async (sig: string) => {
    log.info({ sig }, 'arrêt gracieux : workers stoppés');
    const { stopWorkers } = await import('./jobs');
    stopWorkers();
    const { closePdfBrowser } = await import('./pdf');
    await closePdfBrowser();
    const { getDb } = await import('./data');
    try {
      const db = await getDb();
      await db.close();
    } catch {
      /* déjà fermé */
    }
  };
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    const handler = () => void shutdown(sig);
    process.removeAllListeners(sig);
    process.on(sig, handler);
  }

  // tick quotidien « léger » : licence + backup auto si activé (pas de cron externe requis)
  setInterval(() => {
    void (async () => {
      const { enqueue } = await import('./jobs');
      await enqueue('license.check', {});
      const { getSection } = await import('./settings');
      const bk = (await getSection('backups')) as { auto?: boolean };
      if (bk.auto) await enqueue('backup.run', {});
    })();
  }, 24 * 3600_000).unref();
}
