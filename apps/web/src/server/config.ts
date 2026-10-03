/**
 * Configuration applicative centralisée : aucune valeur métier codée en dur ailleurs.
 * SARDPI_ROOT = racine « métier » du monorepo (locales/, themes/, country-profiles/, data/, storage/) :
 * - dev : détectée en remontant depuis cwd jusqu'à trouver languages.json ;
 * - on-premise / Electron : surchargeable par env (SARDPI_ROOT) ;
 * - aucun chemin ne dépend de __dirname en production (packaging compatible Electron).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from './logger';

function findRoot(): string {
  if (process.env.SARDPI_ROOT) return path.resolve(process.env.SARDPI_ROOT);
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'languages.json')) && fs.existsSync(path.join(dir, 'country-profiles'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // fallback : supposition monorepo standard (<root>/apps/web)
  return path.resolve(process.cwd(), '../..');
}

export const ROOT = findRoot();

/**
 * Chargement des fichiers .env du monorepo.
 * ------------------------------------------------------------------
 * Next.js ne charge que les .env du répertoire de l'application (apps/web), alors que les scripts
 * (vite-node : seed, db:sync, db:export) ont pour racine celle du monorepo : un .env.local placé
 * d'un seul côté était donc lu par l'un et IGNORE par l'autre, silencieusement. Conséquence la
 * plus grave observée : AUTH_SECRET / ENC_KEYS absents du serveur web → JWT dérivé d'un repli et
 * chiffrement au repos des champs sensibles désactivé (exigence loi 18-07), sans aucun message.
 * Ce chargeur aligne les deux environnements sur les MÊMES valeurs.
 *
 * Règle de priorité (la première valeur trouvée gagne) :
 *   1. une variable déjà présente dans process.env n'est JAMAIS écrasée
 *      (pm2, systemd, Docker, `$env:` PowerShell gardent la main) ;
 *   2. `<racine>/.env.local` puis `<racine>/.env` ;
 *   3. `<racine>/apps/web/.env.local` puis `<racine>/apps/web/.env` (emplacement du README).
 * N'utilisez qu'UN seul de ces emplacements en pratique ; les autres servent de repli.
 */
export function loadRootEnv(root: string): string[] {
  const appDir = path.join(root, 'apps', 'web');
  const candidates = [
    path.join(root, '.env.local'),
    path.join(root, '.env'),
    path.join(appDir, '.env.local'),
    path.join(appDir, '.env'),
  ];
  const loaded: string[] = [];
  for (const file of candidates) {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue; // fichier absent : normal en production (variables fournies par l'environnement)
    }
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim().replace(/^export\s+/, '');
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      if (!key || process.env[key] !== undefined) continue;
      let val = line.slice(eq + 1).trim();
      // Guillemets entourant la valeur : retirés, sans interprétation des séquences d'échappement.
      if ((val.startsWith('"') && val.endsWith('"') && val.length > 1) || (val.startsWith("'") && val.endsWith("'") && val.length > 1)) val = val.slice(1, -1);
      process.env[key] = val;
    }
    loaded.push(path.relative(root, file) || file);
  }
  return loaded;
}

/** Fichiers .env effectivement chargés (journalisé au démarrage pour diagnostic). */
export const ENV_FILES = loadRootEnv(ROOT);

export const paths = {
  root: ROOT,
  locales: path.join(ROOT, 'locales'),
  languages: path.join(ROOT, 'languages.json'),
  themes: path.join(ROOT, 'themes'),
  countryProfiles: path.join(ROOT, 'country-profiles'),
  data: path.join(ROOT, process.env.DATA_DIR || 'data'),
  storage: path.join(ROOT, process.env.STORAGE_DIR || 'storage'),
  backups: path.join(ROOT, 'backups'),
  fonts: path.join(process.cwd(), 'public', 'fonts'),
};

export type DataAdapterKind = 'mysql' | 'postgres' | 'json' | 'memory';

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT ?? 3000),
  appUrl: process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
  adapter: (process.env.DATA_ADAPTER ?? 'json') as DataAdapterKind,
  mysql: {
    host: process.env.MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? 'sardpi',
    password: process.env.MYSQL_PASSWORD ?? '',
    database: process.env.MYSQL_DATABASE ?? 'sardpi',
    poolMax: Number(process.env.MYSQL_POOL_MAX ?? 10),
  },
  postgresUrl: process.env.POSTGRES_URL ?? '',
  postgresPoolMax: Number(process.env.POSTGRES_POOL_MAX ?? 10),
  authSecret: process.env.AUTH_SECRET || '',
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),
  encKeys: (process.env.ENC_KEYS || '')
    .split(',')
    .map((kv) => kv.trim())
    .filter(Boolean)
    .map((kv) => {
      const [id, key] = kv.split(':');
      return { id: Number(id), key: key ?? '' };
    })
    .filter((k) => k.id && k.key.length === 64),
  rateLimitRpm: Number(process.env.RATE_LIMIT_RPM ?? 240),
  smtp: {
    enabled: process.env.SMTP_ENABLED === '1',
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: process.env.SMTP_SECURE !== '0',
    user: process.env.SMTP_USER ?? '',
    password: process.env.SMTP_PASSWORD ?? '',
    from: process.env.SMTP_FROM ?? 'sarDPI <no-reply@localhost>',
  },
  captchaProvider: (process.env.CAPTCHA_PROVIDER ?? 'internal') as 'none' | 'internal' | 'turnstile' | 'hcaptcha' | 'recaptcha',
  turnstile: { sitekey: process.env.TURNSTILE_SITEKEY ?? '', secret: process.env.TURNSTILE_SECRET ?? '' },
  hcaptcha: { sitekey: process.env.HCAPTCHA_SITEKEY ?? '', secret: process.env.HCAPTCHA_SECRET ?? '' },
  recaptcha: { sitekey: process.env.RECAPTCHA_SITEKEY ?? '', secret: process.env.RECAPTCHA_SECRET ?? '' },
  puppeteerExecutable: process.env.PUPPETEER_EXECUTABLE_PATH ?? '',
  pdfFormat: process.env.PDF_FORMAT ?? 'A4',
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 20) * 1024 * 1024,
  cacheTtlRef: Number(process.env.CACHE_TTL_REF ?? 300),
  cachePollMs: Number(process.env.CACHE_VERSION_POLL_MS ?? 2000),
  jobPollMs: Number(process.env.JOB_POLL_MS ?? 1500),
  jobWorkers: Number(process.env.JOB_WORKERS ?? 2),
  timezone: process.env.TIMEZONE ?? 'Africa/Algiers',
  defaultLocale: process.env.DEFAULT_LOCALE ?? 'fr',
  licenseKey: process.env.LICENSE_KEY ?? '',
  signedUrlTtlMin: Number(process.env.SIGNED_URL_TTL_MIN ?? 15),
};

// Secret de développement si absent — JAMAIS acceptable en prod (contrôle au boot).
if (!env.authSecret) {
  if (env.isProd) {
    // On ne casse pas le démarrage (config possible via settings), mais on alerte fortement.
    createLogger().fatal('AUTH_SECRET manquant en production — mettez-le dans .env.local ! JWT dérivé instable.');
  }
  // dérivé stable pour le dev (persistance localStorage/IndexedDB du même poste)
  (env as { authSecret: string }).authSecret = process.env.SARDPI_DEV_SECRET || 'dev-only-insecure-secret-change-me-0123456789abcdef0123456789abcdef';
}

const gBoot = globalThis as unknown as { __sardpiBootWarned?: boolean };
export function assertBootConfig() {
  if (gBoot.__sardpiBootWarned) return;
  gBoot.__sardpiBootWarned = true;
  const log = createLogger();
  // Traçabilité de la configuration : quels fichiers .env ont réellement alimenté process.env.
  // Utile en support — c'est l'ambiguïté « Next ne lit que apps/web/.env* » qui rendait muet un
  // .env.local posé à la racine (AUTH_SECRET / ENC_KEYS alors ignorés sans aucun message).
  if (ENV_FILES.length) log.info(`configuration chargée depuis ${ENV_FILES.join(' + ')} (racine : ${ROOT})`);
  else log.info('aucun .env à la racine : configuration lue depuis l’environnement du processus.');
  if (env.adapter === 'json' || env.adapter === 'memory') {
    log.warn(`Adaptateur « ${env.adapter} » : mode démo / hors-ligne / mono-utilisateur. Utilisez DATA_ADAPTER=mysql pour la production.`);
  }
  if (env.encKeys.length === 0) {
    log.warn('ENC_KEYS absent : chiffrement AES-256-GCM des champs sensibles désactivé (loi 18-07 : à activer en production).');
  } else {
    log.info(`chiffrement au repos actif — ${env.encKeys.length} clé(s) AES-256-GCM chargée(s) (ids : ${env.encKeys.map((k) => k.id).join(', ')}).`);
  }
}
