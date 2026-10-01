/**
 * CONTRAT COMMUN DES ADAPTATEURS DE DONNÉES (JSON/memory démo, MySQL/Postgres prod).
 * Tout le code serveur (modules, CRUD, jobs, codes, audit…) ne parle QUE cette interface :
 * changer d'adaptateur ne demande AUCUNE modification applicative. Voir docs/DATABASE.md.
 */

export type Row = Record<string, unknown>;

/** Opérateurs supportés par les deux familles d'adaptateurs (JSON les émule fidèlement). */
export type WhereOp = 'eq' | 'neq' | 'contains' | 'in' | 'gt' | 'gte' | 'lt' | 'lte' | 'isNull' | 'notEmpty' | 'empty' | 'between';

export interface WhereCond {
  field: string;
  op: WhereOp;
  value?: unknown;
  /** uniquement pour op='between' */
  value2?: unknown;
}

/** Clause de recherche « n'importe quel champ contient le terme » (insensible à la casse). */
export interface OrSearch {
  fields: string[];
  term: string;
}

export interface FindOpts {
  /** tableau de conditions, OU forme abrégée { col: valeur } (valeur tableau ⇒ IN implicite) */
  where?: Row | WhereCond[];
  combinator?: 'AND' | 'OR';
  orSearch?: OrSearch;
  orderBy?: Array<[string, 'asc' | 'desc']>;
  limit?: number;
  offset?: number;
  /** SQL uniquement : SELECT … FOR UPDATE (verrou de ligne dans la transaction). */
  forUpdate?: boolean;
}

/** Normalise les 2 formes de `where` en liste de conditions. */
export function toConds(where?: Row | WhereCond[]): WhereCond[] {
  if (!where) return [];
  if (Array.isArray(where)) return where;
  return Object.entries(where).map(([field, value]) =>
    Array.isArray(value) ? { field, op: 'in' as const, value } : { field, op: 'eq' as const, value },
  );
}

/**
 * Les adaptateurs ignorent silencieusement les colonnes inconnues du schéma (sérialisation stricte) :
 * c'est VOLONTAIRE — le schéma TS est la source de vérité, aucune colonne sauvage n'atteint le disque.
 */
export interface DataAdapter {
  /** true pour JSON/memory : émulation mono-poste (auto-incrément par compteur persisté), démo/offline uniquement. */
  readonly demoMode: boolean;
  /** 'mysql' | 'postgres' — absent des adaptateurs non-SQL. */
  readonly dialect?: string;
  init(): Promise<void>;
  close(): Promise<void>;
  /** latence aller-simple en ms (0 possible) — santé + chronométrage. */
  ping(): Promise<number>;

  find<T extends Row = Row>(table: string, opts?: FindOpts): Promise<T[]>;
  /** le 2e argument est soit un FindOpts complet, soit la forme abrégée { col: valeur }. */
  findOne<T extends Row = Row>(table: string, whereOrOpts?: Row | FindOpts): Promise<T | null>;
  count(table: string, opts?: FindOpts): Promise<number>;
  insert(table: string, row: Row): Promise<{ id: number }>;
  insertMany(table: string, rows: Row[]): Promise<number[]>;
  update(table: string, id: number, patch: Row): Promise<void>;
  updateWhere(table: string, where: Row | WhereCond[], patch: Row): Promise<number>;
  remove(table: string, id: number): Promise<void>;
  removeWhere(table: string, where: Row | WhereCond[]): Promise<number>;
  findMax(table: string, col: string, where?: Row): Promise<number>;
  /** rollback complet si le handler lève ; imbriquable (le plus interne ne commit pas seul). */
  transaction<T>(fn: (tx: DataAdapter) => Promise<T>): Promise<T>;
  /** SQL uniquement : requête brute (migrations, SKIP LOCKED du moteur de jobs). */
  execRaw?(sql: string, params?: unknown[]): Promise<unknown>;
}
