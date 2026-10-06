/**
 * PLAN DE MIGRATIONS SQL — sélection des fichiers et tolérance « déjà appliqué ».
 * ---------------------------------------------------------------------------------------------
 * Les migrations de `migrations/` sont écrites à la main et appliquées par `npm run db:migrate`
 * ou le bouton « Migrer » de l'admin. Deux besoins concrets, isolés ici pour être testables :
 *
 *  1. DIALECTE — certains DDL n'ont pas la même syntaxe d'un SGBD à l'autre. Une migration peut
 *     donc porter un suffixe `.mysql.sql` ou `.postgres.sql` ; le fichier sans suffixe est
 *     appliqué partout (instructions portables : UPDATE, INSERT…).
 *     Exemple vécu : `ADD COLUMN IF NOT EXISTS` existe en PostgreSQL mais PAS en MySQL 8.
 *
 *  2. REJEU — le DDL généré est « expand only » et les migrations sont rejouées à chaque
 *     exécution : une erreur « colonne déjà présente » signifie « migration déjà appliquée »,
 *     pas « échec ». Elle est donc ignorée (journalisée), sinon chaque `db:migrate` sortirait
 *     en code 1 sur une base à jour — et un échec RÉEL passerait inaperçu au milieu du bruit.
 */

/** Dialectes SQL gérés (l'adaptateur JSON/démo n'applique aucune migration). */
export type SqlDialect = 'mysql' | 'postgres';

/**
 * Fichiers de migration à appliquer pour un dialecte donné, dans l'ordre lexicographique
 * (d'où la convention de nommage `0001-…`, `0002-…`).
 * Les fichiers des AUTRES dialectes sont écartés, jamais exécutés.
 */
export function migrationFiles(files: string[], dialect: string): string[] {
  return files
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => {
      const tagged = /\.(mysql|postgres)\.sql$/.exec(f);
      return !tagged || tagged[1] === dialect;
    })
    .sort();
}

/** Fichier spécifique à un dialecte ? (null = portable) — utile au journal d'exécution. */
export function dialectOf(file: string): SqlDialect | null {
  const m = /\.(mysql|postgres)\.sql$/.exec(file);
  return (m?.[1] as SqlDialect | undefined) ?? null;
}

/**
 * L'erreur signifie-t-elle que l'instruction est DÉJÀ appliquée ?
 * (rejeu d'une migration idempotente sur une base à jour — ce n'est pas une panne)
 */
export function isAlreadyAppliedError(message: string): boolean {
  return /duplicate column|already exists|existe déjà|duplicate key name|Multiple primary key/i.test(message);
}
