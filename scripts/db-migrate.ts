/**
 * npm run db:migrate — création/mise à jour du schéma SANS redémarrage.
 * - MySQL/Postgres : applique le DDL expand-only généré depuis le schéma TS (CREATE TABLE IF NOT EXISTS,
 *   jamais de DROP, jamais de destructive change) + Migrations SQL libres dans migrations/*.sql ;
 * - JSON/memory (démo) : initialise les fichiers de tables avec compteurs auto-incrémentés.
 */
import fs from 'node:fs';
import path from 'node:path';
import { dialectOf, isAlreadyAppliedError, migrationFiles } from '../apps/web/src/server/data/migrations';

async function main(): Promise<void> {
  process.env.SARDPI_SCRIPT = '1';
  const { getDb, effectiveConfig } = await import('../apps/web/src/server/data');
  const cfg = effectiveConfig();
  console.log(`[db:migrate] adaptateur : ${cfg.adapter}`);
  const db = await getDb(); // getDb() appelle init() → ensureSchema() pour les adaptateurs SQL

  // Migrations SQL optionnelles (avant/après DDL généré — idempotent à la charge de l'auteur).
  // Le dialecte est celui de l'adaptateur : « 0002-x.mysql.sql » n'est pas exécuté sur PostgreSQL,
  // et inversement (voir data/migrations.ts). Une erreur « déjà appliqué » (colonne/table déjà
  // présente) est ignorée : sans quoi chaque rejeu sortirait en code 1 sur une base à jour.
  const migDir = path.resolve(process.cwd(), 'migrations');
  if (fs.existsSync(migDir) && db.execRaw) {
    const dialect = db.dialect ?? 'mysql';
    const files = migrationFiles(fs.readdirSync(migDir), dialect);
    const skipped = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql') && !files.includes(f));
    for (const f of skipped) console.log(`[db:migrate] · migrations/${f} ignoré (dialecte ${dialectOf(f) ?? 'autre'})`);
    for (const f of files) {
      const sql = fs.readFileSync(path.join(migDir, f), 'utf8').trim();
      if (!sql) continue;
      try {
        await db.execRaw(sql);
        console.log(`[db:migrate] ✓ migrations/${f}`);
      } catch (e) {
        const msg = (e as Error).message ?? '';
        if (isAlreadyAppliedError(msg)) {
          console.log(`[db:migrate] ✓ migrations/${f} (déjà appliquée)`);
          continue;
        }
        console.error(`[db:migrate] ✗ migrations/${f} : ${msg}`);
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
