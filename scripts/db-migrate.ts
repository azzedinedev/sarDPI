/**
 * npm run db:migrate — création/mise à jour du schéma SANS redémarrage.
 * - MySQL/Postgres : applique le DDL expand-only généré depuis le schéma TS (CREATE TABLE IF NOT EXISTS,
 *   jamais de DROP, jamais de destructive change) + Migrations SQL libres dans migrations/*.sql ;
 * - JSON/memory (démo) : initialise les fichiers de tables avec compteurs auto-incrémentés.
 */
import fs from 'node:fs';
import path from 'node:path';

async function main(): Promise<void> {
  process.env.SARDPI_SCRIPT = '1';
  const { getDb, effectiveConfig } = await import('../apps/web/src/server/data');
  const cfg = effectiveConfig();
  console.log(`[db:migrate] adaptateur : ${cfg.adapter}`);
  const db = await getDb(); // getDb() appelle init() → ensureSchema() pour les adaptateurs SQL

  // Migrations SQL optionnelles (avant/après DDL généré — idempotent à la charge de l'auteur).
  const migDir = path.resolve(process.cwd(), 'migrations');
  if (fs.existsSync(migDir) && db.execRaw) {
    const files = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      const sql = fs.readFileSync(path.join(migDir, f), 'utf8').trim();
      if (!sql) continue;
      try {
        await db.execRaw(sql);
        console.log(`[db:migrate] ✓ migrations/${f}`);
      } catch (e) {
        console.error(`[db:migrate] ✗ migrations/${f} : ${(e as Error).message}`);
        process.exitCode = 1;
      }
    }
  }

  const ms = await db.ping();
  console.log(`[db:migrate] schéma à jour (ping ${ms} ms, dialecte ${db.dialect ?? 'n/a'})`);
  await db.close();
}

main().catch((e) => {
  console.error('[db:migrate] échec :', e);
  process.exit(1);
});
