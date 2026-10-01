/**
 * POINT D'ENTRÉE DONNÉES — fabrique de l'adaptateur effectif + bascule à chaud.
 * ---------------------------------------------------------------------------
 * Config = .env (MYSQL_*, POSTGRES_URL, DATA_ADAPTER) SOULEVÉE par l'overlay admin data/config.json
 * (écrit par POST /admin/db/test — permet de tester une base sans toucher aux fichiers ni redémarrer ;
 * rollback automatique si le ping échoue). getDb() est MÉMOïsé et idempotent (hot-reload dev, pm2).
 * PROD : adapter=mysql|postgres — json/memory = démo/offline mono-poste uniquement (auto-incrément ÉMULÉ).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mysql2 from 'mysql2/promise';
import { env, paths, ROOT, type DataAdapterKind } from '../config';
import { childLog } from '../logger';
import type { DataAdapter } from './types';
import { JsonAdapter } from './json';
import { MySqlAdapter, PostgresAdapter } from './sql';

const log = childLog('data');

export interface MysqlConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  poolMax?: number;
}
export interface PostgresConfig {
  url?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  poolMax?: number;
}

export interface DbConfig {
  adapter: DataAdapterKind;
  mysql: MysqlConfig;
  postgres: PostgresConfig;
}

/** Overlay écrit par l'admin (« tester une config ») — relu à chaque effectiveConfig(), jamais caché. */
export interface DataOverlay {
  adapter?: DataAdapterKind;
  mysql?: Partial<MysqlConfig>;
  postgresUrl?: string;
}

export interface DbHealth {
  ok: boolean;
  adapter: DataAdapterKind;
  demoMode: boolean;
  /** alias courts pour /readyz (ms + demo) */
  ms: number;
  demo: boolean;
  dbMs: number;
  error?: string;
}

export type { DataAdapter, DataAdapterKind };

function baseConfig(): DbConfig {
  return {
    adapter: env.adapter,
    mysql: { ...env.mysql },
    postgres: { url: env.postgresUrl || undefined, poolMax: env.postgresPoolMax },
  };
}

function overlayFile(): string {
  return path.join(paths.data, 'config.json');
}

export function readOverlay(): DataOverlay {
  try {
    return JSON.parse(fs.readFileSync(overlayFile(), 'utf8')) as DataOverlay;
  } catch {
    return {};
  }
}

export function writeOverlay(o: DataOverlay | null): void {
  fs.mkdirSync(paths.data, { recursive: true });
  if (!o) {
    try {
      fs.rmSync(overlayFile());
    } catch {
      /* déjà absent */
    }
    return;
  }
  fs.writeFileSync(overlayFile(), JSON.stringify(o, null, 1));
  try {
    fs.chmodSync(overlayFile(), 0o600); // peut contenir un mdp SQL — jamais lisible hors user
  } catch {
    /* windows/démo : best effort */
  }
}

export function effectiveConfig(): DbConfig {
  const cfg = baseConfig();
  const ov = readOverlay();
  if (ov.adapter) cfg.adapter = ov.adapter;
  if (ov.mysql) cfg.mysql = { ...cfg.mysql, ...ov.mysql };
  if (ov.postgresUrl) cfg.postgres = { url: ov.postgresUrl };
  return cfg;
}

/** data/ (fichiers JSON démo + overlay + config) — sous le ROOT du dépôt. */
export function dataDir(): string {
  return paths.data;
}

/* --------------------------------------------------------------- MySQL : création de base */

/**
 * BONTÉ DE DÉPLOIEMENT (jamais de crash « Unknown database ») : la base est créée si l'utilisateur a
 * le droit, avec la configuration applicative ; sinon l'erreur d'origine remonte telle quelle.
 */
async function ensureMysqlDatabase(cfg: MysqlConfig): Promise<void> {
  let conn: mysql2.Connection | null = null;
  try {
    conn = await mysql2.createConnection({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, multipleStatements: false });
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${cfg.database.replace(/`/g, '')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } catch (e) {
    log.warn({ err: (e as Error).message }, 'création automatique de la base MySQL ignorée (droits insuffisants ?) — la base doit préexister');
  } finally {
    try {
      await conn?.end();
    } catch {
      /* noop */
    }
  }
}

/* ------------------------------------------------------------------ factory */

/** En dev, Next ré-évalue les modules serveur à chaque recompilation de page : on ne log chaque
 *  branchement d'adaptateur QU'une fois par processus (sinon le terminal devient illisible). */
const gLogged = globalThis as unknown as { __sardpiDataLogged?: Set<string> };
if (!gLogged.__sardpiDataLogged) gLogged.__sardpiDataLogged = new Set<string>();
function logOnceInfo(msg: string, fields: Record<string, unknown> = {}): void {
  const key = msg + JSON.stringify(fields);
  if (gLogged.__sardpiDataLogged!.has(key)) return;
  gLogged.__sardpiDataLogged!.add(key);
  log.info(fields, msg);
}

async function build(cfg: DbConfig): Promise<DataAdapter> {
  switch (cfg.adapter) {
    case 'json': {
      const a = new JsonAdapter(dataDir());
      await a.init();
      logOnceInfo('adaptateur JSON (mode démo — auto-incrément ÉMULÉ, mono-poste)', { dir: dataDir() });
      return a;
    }
    case 'memory': {
      const dir = path.join(os.tmpdir(), `sardpi-mem-${process.pid}`);
      const a = new JsonAdapter(dir, { inMemory: true });
      await a.init();
      logOnceInfo('adaptateur MEMORY (volatile — tests/échauffement uniquement, aucune donnée persistée)');
      return a;
    }
    case 'mysql': {
      await ensureMysqlDatabase(cfg.mysql);
      const a = new MySqlAdapter(cfg.mysql);
      await a.init(); // SELECT 1 + DDL généré depuis schema.ts (IF NOT EXISTS)
      logOnceInfo('adaptateur MySQL prêt', { db: cfg.mysql.database });
      return a;
    }
    case 'postgres': {
      const a = new PostgresAdapter(cfg.postgres);
      await a.init();
      logOnceInfo('adaptateur Postgres prêt');
      return a;
    }
    default:
      throw new Error(`adaptateur de données inconnu : ${String(cfg.adapter)}`);
  }
}

let current: DataAdapter | null = null;
let currentPromise: Promise<DataAdapter> | null = null;
let currentConfigKey = '';

function configKey(cfg: DbConfig): string {
  return `${cfg.adapter}|${cfg.adapter === 'mysql' ? `${cfg.mysql.host}:${cfg.mysql.port}/${cfg.mysql.database}` : ''}${cfg.adapter === 'postgres' ? cfg.postgres.url ?? '' : ''}`;
}

/** Accès unique à l'adaptateur — mémoïsé ; relancé seulement si la config effective a changé (overlay admin). */
export async function getDb(): Promise<DataAdapter> {
  const cfg = effectiveConfig();
  const key = configKey(cfg);
  if (current && key === currentConfigKey) return current;
  if (currentPromise && key === currentConfigKey) return currentPromise;
  currentConfigKey = key;
  currentPromise = build(cfg).then(
    (db) => {
      current = db;
      currentPromise = null;
      return db;
    },
    (e: unknown) => {
      currentPromise = null;
      throw e;
    },
  );
  return currentPromise;
}

/**
 * Reconnexion à chaud (admin POST /admin/db/test) : on ferme l'ancien adaptateur, on reconstruit.
 * @param rollbackAdapter — si fourni, FORCE cet adaptateur (utilisé pour le rollback automatique quand la
 * nouvelle config échoue au ping ; l'overlay déjà écrit reste consultable mais n'est pas rejoué).
 */
export async function reinitDb(rollbackAdapter?: DataAdapterKind): Promise<void> {
  const old = current;
  current = null;
  currentPromise = null;
  currentConfigKey = '';
  if (rollbackAdapter) {
    const ov = readOverlay();
    writeOverlay({ ...ov, adapter: rollbackAdapter });
  }
  try {
    await old?.close();
  } catch (e) {
    log.warn({ err: (e as Error).message }, 'fermeture ancien adaptateur');
  }
  await getDb();
}

/** Ping applicatif nu (admin) — ne lève JAMAIS, renvoie l'état mesuré. */
export async function dbPing(): Promise<DbHealth> {
  const cfg = effectiveConfig();
  try {
    const db = await getDb();
    const ms = await db.ping();
    return { ok: true, adapter: cfg.adapter, demoMode: db.demoMode, ms, demo: db.demoMode, dbMs: ms };
  } catch (e) {
    return { ok: false, adapter: cfg.adapter, demoMode: false, ms: -1, demo: false, dbMs: -1, error: (e as Error).message };
  }
}

/** Santé pour monitoring (GET /api/v1/health) — dbMs = latence mesurée d'un aller-retour réel. */
export async function health(): Promise<DbHealth> {
  return dbPing();
}

/** Migrations SQL libres (scripts/db-migrate) — migrations/*.sql à la racine de l'app. */
export async function applyMigrations(dir?: string): Promise<string[]> {
  const db = await getDb();
  const applied: string[] = [];
  if (!db.execRaw) return applied; // JSON : pas de migration SQL
  const migDir = dir ?? path.resolve(ROOT, 'migrations');
  if (!fs.existsSync(migDir)) return applied;
  for (const f of fs.readdirSync(migDir).filter((x) => x.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(migDir, f), 'utf8').trim();
    if (!sql) continue;
    await db.execRaw(sql);
    applied.push(f);
  }
  return applied;
}
