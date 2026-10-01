/**
 * npm run db:export — export JSON complet (toutes tables, IDs préservés) dans backups/export-<stamp>.json.
 * Sert au transport démo ↔ MySQL et d'entrée pour « import JSON » de l'admin (db/import).
 * Usage : node ... db-export.ts [--out chemin.json]
 */
import fs from 'node:fs';
import path from 'node:path';

async function main(): Promise<void> {
  process.env.SARDPI_SCRIPT = '1';
  const { getDb } = await import('../apps/web/src/server/data');
  const { TABLES } = await import('../apps/web/src/server/data/schema');
  const db = await getDb();
  const out: Record<string, unknown> = {};
  for (const t of TABLES) {
    const rows = await db.find(t.name, { limit: 200_000 });
    out[t.name] = { auto: rows.reduce((m, r) => Math.max(m, Number(r.id ?? 0)), 0), rows };
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const arg = process.argv.indexOf('--out');
  const dest = arg > -1 && process.argv[arg + 1] ? path.resolve(process.argv[arg + 1]!) : path.resolve(process.cwd(), 'backups', `export-${stamp}.json`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(out, null, 1));
  const total = Object.values(out).reduce((n, v) => n + ((v as { rows: unknown[] }).rows.length ?? 0), 0);
  console.log(`[db:export] ${total} lignes → ${dest}`);
  await db.close();
}

main().catch((e) => {
  console.error('[db:export] échec :', e);
  process.exit(1);
});
