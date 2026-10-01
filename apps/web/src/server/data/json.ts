/**
 * ADAPTATEUR JSON (mode DÉMO/HORS-LIGNE) — un fichier `<table>.json` = { auto, rows[] } sous data/.
 * ---------------------------------------------------------------------------
 * ⚠ ASSUMÉ DÉMO/mono-poste par la spec : l'auto-incrément est ÉMULÉ par un compteur persisté dans le
 *   fichier (jamais réutilisé, repris après redémarrage), et le « FOR UPDATE » est un verrou de
 *   processus unique. Les compteurs de code_sequences ne sont JAMAIS mis en cache : chaque écriture
 *   est flushée immédiatement (locked()/flushNow) pour survivre à un crash. En multi-processus ou
 *   multi-poste → passer à MySQL/Postgres (même contrat DataAdapter, zéro changement de code).
 */
import fs from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import { TABLES } from './schema';
import { tableMeta } from './schema';
import { hydrateRow, serializeRow } from './cast';
import { assertTable } from './assertTable';
import type { DataAdapter, FindOpts, Row, WhereCond } from './types';
import { toConds } from './types';

interface TableState {
  rows: Row[];
  auto: number;
}

/** forme abrégée {col: valeur} OU FindOpts complet {where|orSearch|orderBy|limit|offset|combinator} */
function asOpts(x?: Row | FindOpts): FindOpts {
  if (!x) return {};
  const keys = Object.keys(x);
  const optsKeys = new Set(['where', 'orSearch', 'orderBy', 'limit', 'offset', 'combinator', 'forUpdate']);
  if (keys.some((k) => optsKeys.has(k))) return x as FindOpts;
  return { where: x as Row };
}

const OPS: ReadonlySet<string> = new Set(['eq', 'neq', 'contains', 'in', 'gt', 'gte', 'lt', 'lte', 'isNull', 'notEmpty', 'empty', 'between']);

function asText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function asNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined) return NaN;
  const n = Number(v);
  // les dates ISO complètes (« ...T... ») ne deviennent PAS des nombres : comparaison lexicographique
  return typeof v === 'string' && (v.includes('-') || v.includes(':')) ? NaN : n;
}

function looseEq(a: unknown, b: unknown): boolean {
  const na = typeof a === 'boolean' ? (a ? 1 : 0) : a;
  const nb = typeof b === 'boolean' ? (b ? 1 : 0) : b;
  // eslint-disable-next-line eqeqeq
  return na == nb || asText(na).toLowerCase() === asText(nb).toLowerCase();
}

export function matchCond(table: string, row: Row, cond: WhereCond): boolean {
  const meta = tableMeta(table);
  const col = meta.cols.get(cond.field);
  const v = row[cond.field];
  switch (cond.op) {
    case 'eq':
      return looseEq(v, cond.value);
    case 'neq':
      return !looseEq(v, cond.value);
    case 'contains': {
      const t = asText(cond.value).toLowerCase();
      if (!t) return true;
      return asText(v).toLowerCase().includes(t) || (meta.json.has(cond.field) && asText(row[cond.field]).toLowerCase().includes(t));
    }
    case 'in': {
      const list = Array.isArray(cond.value) ? cond.value : [cond.value];
      return list.some((x) => looseEq(v, x));
    }
    case 'isNull':
    case 'empty':
      return v === null || v === undefined || v === '';
    case 'notEmpty':
      return !(v === null || v === undefined || v === '');
    case 'between': {
      if (v === null || v === undefined) return false;
      return (cond.value === undefined || cmp(v, cond.value, col?.kind) >= 0) && (cond.value2 === undefined || cmp(v, cond.value2, col?.kind) <= 0);
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (v === null || v === undefined) return false;
      const r = cmp(v, cond.value, col?.kind);
      if (cond.op === 'gt') return r > 0;
      if (cond.op === 'gte') return r >= 0;
      if (cond.op === 'lt') return r < 0;
      return r <= 0;
    }
    default:
      throw new Error(`opérateur unsupported (JSON) : ${cond.op}`);
  }
}

function cmp(a: unknown, b: unknown, kind?: string): number {
  const na = asNum(a);
  const nb = asNum(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && kind !== 'txt' && kind !== 'str') return na - nb;
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb; // numérique aussi sur chaînes numériques (wilaya '9' < 12)
  return asText(a).localeCompare(asText(b));
}

export function sortRows(table: string, rows: Row[], orderBy?: Array<[string, 'asc' | 'desc']>): Row[] {
  if (!orderBy?.length) return rows;
  const meta = tableMeta(table);
  const out = [...rows];
  for (let i = orderBy.length - 1; i >= 0; i--) {
    const [field, dir] = orderBy[i]!;
    const kind = meta.cols.get(field)?.kind;
    out.sort((ra, rb) => {
      let d = cmp(ra[field], rb[field], kind);
      if (d === 0) d = Number(ra.id ?? 0) - Number(rb.id ?? 0); // stabilité (id = tie-breaker, comme SQL sans ORDER BY supplémentaire n'est pas garanti)
      return dir === 'desc' ? -d : d;
    });
  }
  return out;
}

/** Snapshot profond (les lignes JSON sont du JSON-safe par construction). */
function cloneState(s: Map<string, TableState>): Map<string, TableState> {
  const out = new Map<string, TableState>();
  for (const [k, v] of s) out.set(k, { auto: v.auto, rows: JSON.parse(JSON.stringify(v.rows)) as Row[] });
  return out;
}

export class JsonAdapter implements DataAdapter {
  readonly demoMode = true;
  readonly inMemory: boolean;
  private tables = new Map<string, TableState>();
  private dirty = new Set<string>();
  /** file FIFO des transactions au niveau racine (sérialisation équivalente au FOR UPDATE SQL) */
  private txChain: Promise<unknown> = Promise.resolve();
  /** true pendant transaction() : les flush sont différés jusqu'au commit/rollback */
  private locked = false;
  /** marquage du contexte async D'UNE transaction : une imbrication légitime (handler) hérite du store ;
   *  un appel concurrent externe n'en hérite pas et attend son tour dans la file — pas de fausse imbrication. */
  private readonly nested = new AsyncLocalStorage<boolean>();
  private initialized = false;

  constructor(private readonly dir: string, opts: { inMemory?: boolean } = {}) {
    this.inMemory = Boolean(opts.inMemory);
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    if (!this.inMemory) fs.mkdirSync(this.dir, { recursive: true });
    for (const t of TABLES) {
      const st = this.load(t.name);
      this.tables.set(t.name, st);
    }
  }

  private file(table: string): string {
    return path.join(this.dir, `${table}.json`);
  }

  private load(table: string): TableState {
    if (this.inMemory) return { rows: [], auto: 0 };
    try {
      const raw = fs.readFileSync(this.file(table), 'utf8');
      const parsed = JSON.parse(raw) as { auto?: number; rows?: Row[] };
      const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
      const maxId = rows.reduce((m, r) => Math.max(m, Number(r.id ?? 0)), 0);
      return { rows, auto: Math.max(Number(parsed.auto ?? 0), maxId) };
    } catch {
      return { rows: [], auto: 0 };
    }
  }

  private state(table: string): TableState {
    assertTable(table);
    let st = this.tables.get(table);
    if (!st) {
      st = this.load(table);
      this.tables.set(table, st);
    }
    return st;
  }

  private saveNow(table: string): void {
    this.dirty.delete(table);
    if (this.inMemory) return;
    const st = this.tables.get(table);
    if (!st) return;
    const tmp = this.file(table) + '.tmp';
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({ auto: st.auto, rows: st.rows }));
    fs.renameSync(tmp, this.file(table)); // swap quasi atomique : jamais de fichier à demi écrit
  }

  private afterWrite(table: string): void {
    if (this.locked) {
      this.dirty.add(table);
      return;
    }
    this.saveNow(table);
  }

  /** Force l'écriture immédiate de toutes les tables modifiées (fin de transaction). */
  flushNow(): void {
    for (const t of [...this.dirty]) this.saveNow(t);
  }

  private filter(table: string, opts: FindOpts): Row[] {
    const conds = toConds(opts.where).filter((x) => OPS.has(x.op));
    let rows = this.state(table).rows;
    if (opts.combinator === 'OR' && conds.length > 1) {
      rows = rows.filter((r) => conds.some((cond) => matchCond(table, r, cond)));
    } else if (conds.length) {
      rows = rows.filter((r) => conds.every((cond) => matchCond(table, r, cond)));
    }
    if (opts.orSearch && opts.orSearch.term) {
      const term = opts.orSearch.term.toLowerCase();
      const fields = opts.orSearch.fields;
      rows = rows.filter((r) => fields.some((f) => asText(r[f]).toLowerCase().includes(term)));
    }
    return rows;
  }

  async find<T extends Row = Row>(table: string, opts: FindOpts = {}): Promise<T[]> {
    await this.init();
    let rows = this.filter(table, opts);
    rows = sortRows(table, rows, opts.orderBy);
    const off = opts.offset ?? 0;
    if (off) rows = rows.slice(off);
    const limit = opts.limit ?? 1000;
    if (rows.length > limit) rows = rows.slice(0, limit);
    return rows.map((r) => hydrateRow(table, r)! as T);
  }

  async findOne<T extends Row = Row>(table: string, whereOrOpts?: Row | FindOpts): Promise<T | null> {
    const rows = await this.find<T>(table, { ...asOpts(whereOrOpts), limit: 1 });
    return rows[0] ?? null;
  }

  async count(table: string, opts: FindOpts = {}): Promise<number> {
    await this.init();
    return this.filter(table, opts).length;
  }

  async insert(table: string, row: Row): Promise<{ id: number }> {
    await this.init();
    const st = this.state(table);
    const meta = tableMeta(table);
    const ser = serializeRow(table, row, false);
    if (meta.cols.has('created_at') && ser.created_at === undefined) ser.created_at = new Date().toISOString();
    if (meta.cols.has('updated_at') && ser.updated_at === undefined) ser.updated_at = new Date().toISOString();
    delete ser.id;
    const id = ++st.auto;
    st.rows.push({ id, ...ser });
    this.afterWrite(table);
    return { id };
  }

  async insertMany(table: string, rows: Row[]): Promise<number[]> {
    const ids: number[] = [];
    for (const r of rows) ids.push((await this.insert(table, r)).id);
    return ids;
  }

  async update(table: string, id: number, patch: Row): Promise<void> {
    await this.init();
    const st = this.state(table);
    const row = st.rows.find((r) => Number(r.id) === Number(id));
    if (!row) return; // le CRUD a vérifié l'existence avant — ici, id absent = no-op
    const ser = serializeRow(table, patch, false);
    if (tableMeta(table).cols.has('updated_at')) ser.updated_at = new Date().toISOString();
    delete ser.id;
    Object.assign(row, ser);
    this.afterWrite(table);
  }

  async updateWhere(table: string, where: Row | WhereCond[], patch: Row): Promise<number> {
    const matches = await this.find(table, { where, limit: 100_000 });
    let n = 0;
    for (const m of matches) {
      await this.update(table, Number(m.id), patch);
      n++;
    }
    return n;
  }

  async remove(table: string, id: number): Promise<void> {
    await this.init();
    const st = this.state(table);
    const before = st.rows.length;
    st.rows = st.rows.filter((r) => Number(r.id) !== Number(id));
    if (st.rows.length !== before) this.afterWrite(table);
  }

  async removeWhere(table: string, where: Row | WhereCond[]): Promise<number> {
    await this.init();
    const st = this.state(table);
    const matches = await this.find(table, { where, limit: 100_000 });
    const ids = new Set(matches.map((m) => Number(m.id)));
    const before = st.rows.length;
    st.rows = st.rows.filter((r) => !ids.has(Number(r.id)));
    const n = before - st.rows.length;
    if (n) this.afterWrite(table);
    return n;
  }

  async findMax(table: string, col: string, where?: Row): Promise<number> {
    const rows = await this.find(table, { where, limit: 100_000 });
    return rows.reduce((m, r) => Math.max(m, Number(r[col] ?? 0) || 0), 0);
  }

  async transaction<T>(fn: (tx: DataAdapter) => Promise<T>): Promise<T> {
    await this.init();
    if (this.nested.getStore()) return fn(this); // imbriquée dans une tx déjà active : le snapshot parent gère l'atomicité
    // file sérialisée : les transactions CONCURRENTES (ex. 20 allocations de codes parallèles) tournent
    // une à une — équivalent du FOR UPDATE SQL côté JSON. Sans ceci, deux tx lisent le même compteur.
    const res = this.txChain.then(async () =>
      this.nested.run(true, async () => {
        const snapshot = cloneState(this.tables);
        this.locked = true;
        try {
          const r = await fn(this);
          this.locked = false;
          this.flushNow();
          return r;
        } catch (e) {
          this.locked = false;
          this.tables = snapshot; // ROLLBACK complet : lignes ET compteurs auto reviennent
          this.flushNow();
          for (const t of this.tables.keys()) this.saveNow(t); // le rollback doit aussi atterrir sur le disque
          throw e;
        } finally {
          this.locked = false;
        }
      }),
    );
    this.txChain = res.then(
      () => undefined,
      () => undefined,
    ); // la chaîne survit aux échecs
    return res;
  }

  close(): Promise<void> {
    this.flushNow();
    return Promise.resolve();
  }

  async ping(): Promise<number> {
    const t0 = Date.now();
    this.state('settings');
    return Math.max(Date.now() - t0, 1);
  }
}
