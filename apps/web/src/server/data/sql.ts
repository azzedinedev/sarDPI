/**
 * ADAPTATEURS SQL — MySQL (prod recommandée) et Postgres, contrat DataAdapter STRICTEMENT identique
 * à l'adaptateur JSON : mêmes appels, mêmes sémantiques (forUpdate, transaction, orSearch, soft delete).
 * - Le DDL n'est JAMAIS écrit ici : généré depuis schema.ts (generateDDL) — une seule source de vérité.
 * - Les codes : SELECT … FOR UPDATE sur code_sequences dans la transaction (anti-doublon sous concurrence).
 * - Le moteur de jobs utilise execRaw (tuple [rows, fields] à la mysql2) + SKIP LOCKED (claim sans blocage).
 * - Aucun cache applicatif ne touche les compteurs de séquences (exigence §4).
 */
import mysql2 from 'mysql2/promise';
import { Pool as PgPool, type PoolClient, type QueryResult } from 'pg';
import { generateDDL, tableMeta } from './schema';
import { hydrateRow, serializeRow } from './cast';
import { assertCol, assertTable } from './assertTable';
import type { DataAdapter, FindOpts, Row, WhereCond } from './types';
import { toConds } from './types';
import type { MysqlConfig, PostgresConfig } from './index';

const OPT_KEYS = new Set(['where', 'orSearch', 'orderBy', 'limit', 'offset', 'combinator', 'forUpdate']);

function asOpts(x?: Row | FindOpts): FindOpts {
  if (!x) return {};
  if (Object.keys(x).some((k) => OPT_KEYS.has(k))) return x as FindOpts;
  return { where: x as Row };
}

abstract class BaseSqlAdapter implements DataAdapter {
  abstract readonly demoMode: boolean;
  abstract readonly dialect: 'mysql' | 'postgres';
  abstract init(): Promise<void>;
  abstract close(): Promise<void>;
  abstract ping(): Promise<number>;
  /** tuple mysql2-like : [rows, fields] — le moteur de jobs s'y attend pour les DEUX dialectes. */
  abstract execRaw(sql: string, params?: unknown[]): Promise<unknown>;
  abstract transaction<T>(fn: (tx: DataAdapter) => Promise<T>): Promise<T>;
  protected abstract exec(sql: string, params: unknown[]): Promise<Row[]>;
  protected abstract run(sql: string, params: unknown[]): Promise<unknown>;

  protected ph(idx: number): string {
    return this.dialect === 'postgres' ? `$${idx}` : '?';
  }

  protected quote(name: string): string {
    return this.dialect === 'postgres' ? `"${name.replace(/"/g, '""')}"` : `\`${name.replace(/`/g, '')}\``;
  }

  /** expression lisible pour LIKE : les colonnes JSON sont castées en texte. */
  private likeExpr(table: string, field: string): string {
    const col = this.quote(field);
    if (!tableMeta(table).json.has(field)) return col;
    return this.dialect === 'postgres' ? `${col}::text` : `CAST(${col} AS CHAR)`;
  }

  /** Une condition → fragment SQL + push des paramètres. */
  private condSql(table: string, cond: WhereCond, params: unknown[]): string {
    assertCol(table, cond.field);
    const col = this.quote(cond.field);
    const p = (v: unknown): string => {
      params.push(v);
      return this.ph(params.length);
    };
    const likeOp = this.dialect === 'postgres' ? 'ILIKE' : 'LIKE';
    const likeP = (v: unknown): string => p(`%${String(v ?? '').replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
    switch (cond.op) {
      case 'eq':
        if (cond.value === null || cond.value === undefined) return `${col} IS NULL`;
        return typeof cond.value === 'string' && !cond.value.includes(' ') && tableMeta(table).json.has(cond.field)
          ? `${this.likeExpr(table, cond.field)} LIKE ${likeP(cond.value)}` // contient (json, insensible à la casse côté mysql)
          : `${col} = ${p(cond.value)}`;
      case 'neq':
        if (cond.value === null || cond.value === undefined) return `${col} IS NOT NULL`;
        return `(${col} <> ${p(cond.value)} OR ${col} IS NULL)`;
      case 'contains':
        return `${this.likeExpr(table, cond.field)} ${likeOp} ${likeP(cond.value)} ESCAPE '\\'`;
      case 'in': {
        const list = Array.isArray(cond.value) ? cond.value : [cond.value];
        if (!list.length) return '1 = 0';
        return `${col} IN (${list.map((x) => p(x)).join(', ')})`;
      }
      case 'isNull':
      case 'empty':
        return `(${col} IS NULL OR ${col} = '')`;
      case 'notEmpty':
        return `(${col} IS NOT NULL AND ${col} <> '')`;
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte':
        return `${col} ${{ gt: '>', gte: '>=', lt: '<', lte: '<=' }[cond.op]} ${p(cond.value)}`;
      case 'between':
        return `${col} BETWEEN ${p(cond.value)} AND ${p(cond.value2)}`;
      default:
        throw new Error(`opérateur unsupported (SQL) : ${String((cond as WhereCond).op)}`);
    }
  }

  /** WHERE complet, parenthésé, combinateur respecting OR global + orSearch. */
  protected whereClause(table: string, opts: FindOpts, params: unknown[]): string {
    const conds = toConds(opts.where);
    const frags: string[] = [];
    if (conds.length) {
      const parts = conds.map((x) => this.condSql(table, x, params));
      frags.push(parts.length === 1 ? parts[0]! : `(${parts.join(opts.combinator === 'OR' ? ' OR ' : ' AND ')})`);
    }
    if (opts.orSearch?.term) {
      const fields = opts.orSearch.fields.filter((f) => tableMeta(table).cols.has(f));
      const likeOp = this.dialect === 'postgres' ? 'ILIKE' : 'LIKE';
      const parts = fields.map((f) => `${this.likeExpr(table, f)} ${likeOp} ${this.ph(params.length + 1)} ESCAPE '\\'`);
      // push APRES génération pour l'ordre des paramètres pg
      fields.forEach((f) => params.push(`%${String(opts.orSearch!.term ?? '').replace(/[\\%_]/g, (m) => `\\${m}`)}%`));
      frags.push(parts.length ? `(${parts.join(' OR ')})` : '1 = 0');
    }
    return frags.length ? ` WHERE ${frags.join(opts.combinator === 'OR' && conds.length ? ' OR ' : ' AND ')}` : '';
  }

  /* ------------------------------------------------------------- lecture */

  async find<T extends Row = Row>(table: string, opts: FindOpts = {}): Promise<T[]> {
    assertTable(table);
    const params: unknown[] = [];
    let sql = `SELECT * FROM ${this.quote(table)}${this.whereClause(table, opts, params)}`;
    if (opts.orderBy?.length) {
      sql += ` ORDER BY ${opts.orderBy
        .map(([f, dir]) => {
          assertCol(table, f);
          return `${this.quote(f)} ${dir === 'desc' ? 'DESC' : 'ASC'}`;
        })
        .join(', ')}`;
    } else sql += ' ORDER BY id ASC';
    sql += ` LIMIT ${Math.max(0, Math.trunc(opts.limit ?? 1000))} OFFSET ${Math.max(0, Math.trunc(opts.offset ?? 0))}`;
    if (opts.forUpdate) sql += ' FOR UPDATE';
    const rows = await this.exec(sql, params);
    return rows.map((r) => hydrateRow(table, r)! as T);
  }

  async findOne<T extends Row = Row>(table: string, whereOrOpts?: Row | FindOpts): Promise<T | null> {
    const opts = asOpts(whereOrOpts);
    const rows = await this.find<T>(table, { ...opts, limit: 1 });
    return rows[0] ?? null;
  }

  async count(table: string, opts: FindOpts = {}): Promise<number> {
    assertTable(table);
    const params: unknown[] = [];
    const rows = await this.exec(`SELECT COUNT(*) AS c FROM ${this.quote(table)}${this.whereClause(table, opts, params)}`, params);
    return Number(rows[0]?.c ?? 0);
  }

  async findMax(table: string, col: string, where?: Row): Promise<number> {
    assertTable(table);
    assertCol(table, col);
    const params: unknown[] = [];
    const rows = await this.exec(`SELECT COALESCE(MAX(${this.quote(col)}), 0) AS m FROM ${this.quote(table)}${this.whereClause(table, { where }, params)}`, params);
    return Number(rows[0]?.m ?? 0);
  }

  /* ----------------------------------------------------------- écriture */

  async insert(table: string, row: Row): Promise<{ id: number }> {
    assertTable(table);
    const meta = tableMeta(table);
    const ser = serializeRow(table, row, true);
    if (meta.cols.has('created_at') && ser.created_at === undefined) ser.created_at = new Date().toISOString();
    if (meta.cols.has('updated_at') && ser.updated_at === undefined) ser.updated_at = new Date().toISOString();
    delete ser.id;
    const cols = Object.keys(ser).filter((k) => ser[k] !== undefined);
    if (!cols.length) throw new Error('insert sans colonnes');
    const params = cols.map((k) => (typeof ser[k] === 'object' && ser[k] !== null ? JSON.stringify(ser[k]) : ser[k]));
    if (this.dialect === 'postgres') {
      const rows = await this.exec(
        `INSERT INTO ${this.quote(table)} (${cols.map((k) => this.quote(k)).join(', ')}) VALUES (${params.map((_, i) => this.ph(i + 1)).join(', ')}) RETURNING id`,
        params,
      );
      return { id: Number(rows[0]!.id) };
    }
    const res = (await this.run(`INSERT INTO ${this.quote(table)} (${cols.map((k) => this.quote(k)).join(', ')}) VALUES (${params.map(() => '?').join(', ')})`, params)) as { insertId?: number };
    return { id: Number(res?.insertId ?? 0) };
  }

  async insertMany(table: string, rows: Row[]): Promise<number[]> {
    const ids: number[] = [];
    for (const r of rows) ids.push((await this.insert(table, r)).id);
    return ids;
  }

  async update(table: string, id: number, patch: Row): Promise<void> {
    assertTable(table);
    const meta = tableMeta(table);
    const ser = serializeRow(table, patch, true);
    delete ser.id;
    if (meta.cols.has('updated_at')) ser.updated_at = new Date().toISOString();
    const cols = Object.keys(ser).filter((k) => ser[k] !== undefined);
    if (!cols.length) return;
    const params = cols.map((k) => (typeof ser[k] === 'object' && ser[k] !== null ? JSON.stringify(ser[k]) : ser[k]));
    params.push(id);
    const set = cols.map((k, i) => `${this.quote(k)} = ${this.ph(i + 1)}`).join(', ');
    await this.exec(`UPDATE ${this.quote(table)} SET ${set} WHERE id = ${this.ph(params.length)}`, params);
  }

  async updateWhere(table: string, where: Row | WhereCond[], patch: Row): Promise<number> {
    const matches = await this.find(table, { where, limit: 50_000 });
    for (const m of matches) await this.update(table, Number(m.id), patch);
    return matches.length;
  }

  async remove(table: string, id: number): Promise<void> {
    assertTable(table);
    await this.exec(`DELETE FROM ${this.quote(table)} WHERE id = ${this.ph(1)}`, [id]);
  }

  async removeWhere(table: string, where: Row | WhereCond[]): Promise<number> {
    const params: unknown[] = [];
    const w = this.whereClause(table, { where }, params);
    const rows = await this.exec(`SELECT id FROM ${this.quote(table)}${w}`, params);
    for (const r of rows) await this.remove(table, Number(r.id));
    return rows.length;
  }

  async ensureSchema(): Promise<void> {
    const ddl = generateDDL(this.dialect);
    for (const st of ddl.split(';').map((s) => s.trim()).filter(Boolean)) {
      try {
        await this.run(st, []);
      } catch (e) {
        const msg = (e as Error).message ?? '';
        // « déjà existant » est NORMAL au rejeu du migrate (expand-only) — tout le reste remonte
        if (!/already exists|duplicate|already\b/i.test(msg)) throw e;
      }
    }
  }
}

/* ------------------------------------------------------------------ MySQL */

export class MySqlAdapter extends BaseSqlAdapter {
  readonly demoMode = false;
  readonly dialect = 'mysql' as const;
  pool: mysql2.Pool;

  constructor(readonly cfg: MysqlConfig) {
    super();
    this.pool = mysql2.createPool({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      connectionLimit: cfg.poolMax ?? 10,
      waitForConnections: true,
      dateStrings: true, // l'adaptateur hydrate lui-même — évite les dérives de fuseau du driver
      charset: 'utf8mb4_unicode_ci',
      supportBigNumbers: true,
    });
  }

  protected async exec(sql: string, params: unknown[]): Promise<Row[]> {
    const [rows] = await this.pool.query(sql, params);
    return Array.isArray(rows) ? (rows as Row[]) : [];
  }

  protected async run(sql: string, params: unknown[]): Promise<unknown> {
    const [res] = await this.pool.query(sql, params);
    return res;
  }

  async execRaw(sql: string, params: unknown[] = []): Promise<unknown> {
    const [rows, fields] = await this.pool.query(sql, params);
    return [rows, fields];
  }

  async init(): Promise<void> {
    await this.run('SELECT 1', []);
    await this.ensureSchema();
  }

  async ping(): Promise<number> {
    const t0 = Date.now();
    await this.run('SELECT 1', []);
    return Math.max(Date.now() - t0, 1);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async transaction<T>(fn: (tx: DataAdapter) => Promise<T>): Promise<T> {
    const conn = await this.pool.getConnection();
    try {
      return await runInMysqlTx(conn, this, fn);
    } finally {
      conn.release();
    }
  }

  async exportTable(table: string): Promise<Row[]> {
    assertTable(table);
    return this.exec(`SELECT * FROM ${this.quote(table)}`, []);
  }

  async importTable(table: string, rows: Row[]): Promise<void> {
    assertTable(table);
    await this.run('SET FOREIGN_KEY_CHECKS = 0', []);
    try {
      await this.run(`TRUNCATE TABLE ${this.quote(table)}`, []);
      for (const r of rows) {
        const ser = serializeRow(table, r, true);
        const cols = Object.keys(ser).filter((k) => ser[k] !== undefined);
        if (!cols.length) continue;
        const params = cols.map((k) => (typeof ser[k] === 'object' && ser[k] !== null ? JSON.stringify(ser[k]) : ser[k]));
        await this.exec(
          `INSERT INTO ${this.quote(table)} (${cols.map((k) => this.quote(k)).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
          params,
        );
      }
      const maxId = rows.reduce((m, r) => Math.max(m, Number(r.id ?? 0)), 0);
      if (maxId > 0) await this.run(`ALTER TABLE ${this.quote(table)} AUTO_INCREMENT = ${maxId + 1}`, []);
    } finally {
      await this.run('SET FOREIGN_KEY_CHECKS = 1', []);
    }
  }
}

/** Transaction MySQL : le tx wrapper partage la connexion (le pool du parent n'est JAMAIS utilisé ici). */
async function runInMysqlTx<T>(conn: mysql2.PoolConnection, parent: MySqlAdapter, fn: (tx: DataAdapter) => Promise<T>): Promise<T> {
  const tx = new MysqlTx(conn, parent.pool);
  await conn.beginTransaction();
  try {
    const r = await fn(tx);
    await conn.commit();
    return r;
  } catch (e) {
    await conn.rollback().catch(() => undefined);
    throw e;
  }
}

class MysqlTx extends MySqlAdapter {
  private readonly conn: mysql2.PoolConnection;
  constructor(conn: mysql2.PoolConnection, parentPool: mysql2.Pool) {
    super({ host: '', port: 0, user: '', password: '', database: '' });
    this.conn = conn;
    void parentPool; // volontairement inutilisé : toutes les requêtes de la tx passent par conn
    this.pool = parentPool; // ne sert qu'à close()/ping() — neutralisés ci-dessous
  }
  protected override async exec(sql: string, params: unknown[]): Promise<Row[]> {
    const [rows] = await this.conn.query(sql, params);
    return Array.isArray(rows) ? (rows as Row[]) : [];
  }
  protected override async run(sql: string, params: unknown[]): Promise<unknown> {
    const [res] = await this.conn.query(sql, params);
    return res;
  }
  override async execRaw(sql: string, params: unknown[] = []): Promise<unknown> {
    const [rows, fields] = await this.conn.query(sql, params);
    return [rows, fields];
  }
  override async init(): Promise<void> {
    /* no-op : le pool parent a déjà initialisé le schéma */
  }
  override async close(): Promise<void> {
    /* no-op : durée de vie = transaction */
  }
  override async ping(): Promise<number> {
    const t0 = Date.now();
    await this.exec('SELECT 1', []);
    return Math.max(Date.now() - t0, 1);
  }
  override async transaction<T>(fn: (tx: DataAdapter) => Promise<T>): Promise<T> {
    return fn(this); // imbriqué dans la tx courante — savepoint inutile à notre niveau d'usage
  }
  override async ensureSchema(): Promise<void> {
    /* no-op */
  }
}

/* -------------------------------------------------------------- Postgres */

export class PostgresAdapter extends BaseSqlAdapter {
  readonly demoMode = false;
  readonly dialect = 'postgres' as const;
  private pool: PgPool;

  constructor(cfg: PostgresConfig) {
    super();
    this.pool = new PgPool(
      cfg.url
        ? { connectionString: cfg.url, max: cfg.poolMax ?? 10, application_name: 'sardpi' }
        : { host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database, max: cfg.poolMax ?? 10, application_name: 'sardpi' },
    );
  }

  protected async exec(sql: string, params: unknown[]): Promise<Row[]> {
    const res = (await this.pool.query(sql, params)) as QueryResult;
    return res.rows as Row[];
  }

  protected async run(sql: string, params: unknown[]): Promise<unknown> {
    const res = (await this.pool.query(sql, params)) as QueryResult;
    return { rows: res.rows, rowCount: res.rowCount, insertId: (res.rows[0] as Row | undefined)?.id };
  }

  async execRaw(sql: string, params: unknown[] = []): Promise<unknown> {
    const res = (await this.pool.query(sql, params)) as QueryResult;
    return [res.rows, [res.rowCount ?? 0]]; // tuple [rows, fields] — contrat commun avec mysql2
  }

  async init(): Promise<void> {
    await this.run('SELECT 1', []);
    await this.ensureSchema();
  }

  async ping(): Promise<number> {
    const t0 = Date.now();
    await this.run('SELECT 1', []);
    return Math.max(Date.now() - t0, 1);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async transaction<T>(fn: (tx: DataAdapter) => Promise<T>): Promise<T> {
    const conn = await this.pool.connect();
    const tx = new PgTx(conn);
    try {
      await conn.query('BEGIN');
      const r = await fn(tx);
      await conn.query('COMMIT');
      return r;
    } catch (e) {
      await conn.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      conn.release();
    }
  }

  async exportTable(table: string): Promise<Row[]> {
    assertTable(table);
    return this.exec(`SELECT * FROM ${this.quote(table)}`, []);
  }

  async importTable(table: string, rows: Row[]): Promise<void> {
    assertTable(table);
    await this.run(`TRUNCATE TABLE ${this.quote(table)} RESTART IDENTITY CASCADE`, []);
    for (const r of rows) {
      const ser = serializeRow(table, r, true);
      const cols = Object.keys(ser).filter((k) => ser[k] !== undefined);
      if (!cols.length) continue;
      const params = cols.map((k) => (typeof ser[k] === 'object' && ser[k] !== null ? JSON.stringify(ser[k]) : ser[k]));
      await this.exec(
        `INSERT INTO ${this.quote(table)} (${cols.map((k) => this.quote(k)).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
        params,
      );
    }
    const maxId = rows.reduce((m, r) => Math.max(m, Number(r.id ?? 0)), 0);
    if (maxId > 0) await this.run(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), ${maxId} + 1, false)`, []);
  }
}

class PgTx extends PostgresAdapter {
  private readonly conn: PoolClient;
  constructor(client: PoolClient) {
    super({ url: '' });
    this.conn = client;
  }
  protected override async exec(sql: string, params: unknown[]): Promise<Row[]> {
    const res = await this.conn.query(sql, params);
    return res.rows as Row[];
  }
  protected override async run(sql: string, params: unknown[]): Promise<unknown> {
    const res = await this.conn.query(sql, params);
    return { rows: res.rows, rowCount: res.rowCount };
  }
  override async execRaw(sql: string, params: unknown[] = []): Promise<unknown> {
    const res = await this.conn.query(sql, params);
    return [res.rows, [res.rowCount ?? 0]];
  }
  override async init(): Promise<void> {
    /* no-op */
  }
  override async ensureSchema(): Promise<void> {
    /* no-op */
  }
  override async close(): Promise<void> {
    /* no-op */
  }
  override async ping(): Promise<number> {
    const t0 = Date.now();
    await this.exec('SELECT 1', []);
    return Math.max(Date.now() - t0, 1);
  }
  override async transaction<T>(fn: (tx: DataAdapter) => Promise<T>): Promise<T> {
    return fn(this);
  }
  /** le tx ne doit JAMAIS terminer le pool parent (close() no-op suffit — pool inaccessible ici). */
}
