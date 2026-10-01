/**
 * i18n SERVEUR — fichiers /locales/{lang}/{ns}.json.
 *  - cache mémoire avec TTL mtime (rechargement À CHAUD : modifier un JSON change le mtime → invalidation, sans redémarrage) ;
 *  - JSON invalide → fichier REJETÉ, l'ancien contenu en cache reste actif (aucun crash) ;
 *  - ETag = sha1(contenu) → HTTP 304 sur l'API ;
 *  - langue de secours configurable (fr), clés manquantes JOURNALISÉES (rapport admin > Traductions) ;
 *  - manifeste languages.json validé par Zod : un manifeste invalide est ignoré et remonté en admin.
 */
import fs from 'node:fs';
import path from 'node:path';
import { paths, env } from '../config';
import { sha256 } from '../util';
import { languagesManifestZ, type LanguagesManifest } from '@sardpi/shared';

interface NsCache {
  mtimeMs: number;
  data: Record<string, string>;
  etag: string;
  invalid?: string; // dernier JSON rejeté (pour le rapport admin)
}

const nsCache = new Map<string, NsCache>(); // `${lang}/${ns}`
const missingKeys = new Map<string, number>(); // "lang/ns/key" → occurrences (vidé au rapport)

/* --------------------------------------------------------- languages.json */

let languagesCache: { mtimeMs: number; manifest: LanguagesManifest } | null = null;
export let languagesError: string | null = null;

export function getLanguages(): LanguagesManifest {
  try {
    const st = fs.statSync(paths.languages);
    if (languagesCache && languagesCache.mtimeMs === st.mtimeMs) return languagesCache.manifest;
    const raw = JSON.parse(fs.readFileSync(paths.languages, 'utf8')) as unknown;
    const manifest = languagesManifestManifestParse(raw);
    languagesCache = { mtimeMs: st.mtimeMs, manifest };
    languagesError = null;
    return manifest;
  } catch (e) {
    languagesError = (e as Error).message;
    if (languagesCache) return languagesCache.manifest; // l'ancien garde la main
    // repli minimal pour ne jamais casser l'app
    return {
      default: 'fr',
      fallback: 'fr',
      namespaces: ['common', 'auth', 'patient', 'settings', 'errors', 'pdf'],
      languages: [
        { code: 'ar', name: 'العربية', dir: 'rtl', font: "'IBM Plex Sans Arabic', sans-serif", locale: 'ar-DZ', numberingSystem: 'latn' },
        { code: 'fr', name: 'Français', dir: 'ltr', font: "'IBM Plex Sans', sans-serif", locale: 'fr-DZ', numberingSystem: 'latn' },
      ],
    };
  }
}

function languagesManifestManifestParse(raw: unknown): LanguagesManifest {
  const parsed = languagesManifestZ.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`languages.json invalide — ${issues}`);
  }
  return parsed.data;
}

export function langDef(code: string) {
  const m = getLanguages();
  return m.languages.find((l) => l.code === code) ?? m.languages.find((l) => l.code === m.fallback) ?? m.languages[0]!;
}

/* ------------------------------------------------------------ namespaces */

function nsFile(lang: string, ns: string): string {
  return path.join(paths.locales, lang, `${ns}.json`);
}

export function loadNamespace(lang: string, ns: string): NsCache {
  const ck = `${lang}/${ns}`;
  const file = nsFile(lang, ns);
  let st: fs.Stats | null = null;
  try {
    st = fs.statSync(file);
  } catch {
    st = null;
  }
  const hit = nsCache.get(ck);
  if (st && hit && hit.mtimeMs === st.mtimeMs) return hit;
  if (st) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;
      if (typeof data !== 'object' || data === null) throw new Error('racine non-objet');
      const next: NsCache = { mtimeMs: st.mtimeMs, data, etag: sha256(JSON.stringify(data)).slice(0, 16) };
      nsCache.set(ck, next);
      return next;
    } catch (e) {
      const invalid: NsCache = { ...(hit ?? { mtimeMs: 0, data: {}, etag: 'none' }), invalid: `${file} : ${(e as Error).message}` };
      nsCache.set(ck, invalid); // l'ANCIEN contenu reste servi ; l'erreur est exposée en admin
      return invalid;
    }
  }
  // fichier absent
  const empty = hit ?? { mtimeMs: 0, data: {}, etag: 'none', invalid: `fichier manquant : ${file}` };
  return empty;
}

export function invalidateI18nCache(): void {
  nsCache.clear();
  languagesCache = null;
}

/** Traduction serveur (e-mails, PDF, SSR). Résout lang → fallback → toute langue dispo ; sinon null. */
export function t(lang: string, ns: string, key: string, vars?: Record<string, string | number>): string {
  const m = getLanguages();
  const chain = [lang, m.fallback, ...m.languages.map((l) => l.code)].filter((v, i, a) => a.indexOf(v) === i);
  for (const l of chain) {
    const data = loadNamespace(l, ns).data;
    const raw = data[key];
    if (raw !== undefined) return interpolate(raw, vars);
  }
  missingKeys.set(`${lang}/${ns}/${key}`, (missingKeys.get(`${lang}/${ns}/${key}`) ?? 0) + 1);
  return interpolate(`[${key}]`, vars);
}

export function interpolate(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

/** Rapport des clés manquantes signalées par les clients (endpoint i18n — merge fallback). */
export function reportClientMissing(lang: string, ns: string, keys: string[]): void {
  for (const k of keys) missingKeys.set(`${lang}/${ns}/${k}`, (missingKeys.get(`${lang}/${ns}/${k}`) ?? 0) + 1);
}

export function getMissingKeysReport() {
  return [...missingKeys.entries()]
    .map(([k, n]) => ({ key: k, count: n }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 200);
}

export function clearMissingKeysReport(): void {
  missingKeys.clear();
}

/** État des fichiers i18n pour l'admin (invalident/absents). */
export function i18nHealth() {
  const m = getLanguages();
  const issues: { file: string; error: string }[] = [];
  if (languagesError) issues.push({ file: 'languages.json', error: languagesError });
  for (const l of m.languages) {
    for (const ns of m.namespaces) {
      const c = nsCache.get(`${l.code}/${ns}`);
      if (c?.invalid) issues.push({ file: `locales/${l.code}/${ns}.json`, error: c.invalid });
    }
  }
  return { languages: m.languages.map((l) => l.code), default: m.default, fallback: m.fallback, issues };
}

export function allowedLocales(): string[] {
  return getLanguages().languages.map((l) => l.code);
}

export function pickLocale(preferred: string | null | undefined): string {
  const m = getLanguages();
  const list = m.languages.map((l) => l.code);
  if (preferred && list.includes(preferred)) return preferred;
  return list.includes(m.default) ? m.default : (list[0] ?? 'fr');
}

export { env };

/** Langue de secours (fallback) du manifest. */
export function getFallbackLanguage(): string {
  return getLanguages().fallback;
}
