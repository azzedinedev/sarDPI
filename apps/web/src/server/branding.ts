/**
 * IDENTITÉ VISUELLE DE L'APPLICATION (logo + icône d'onglet) — §Paramètres » Général.
 * -----------------------------------------------------------------------------------
 * Pourquoi ce module plutôt qu'un simple champ « URL » dans les réglages :
 *  - le fichier vit HORS BASE (`storage/branding/`), comme la GED : la base ne stocke que le chemin
 *    relatif, le mime, la taille et l'empreinte SHA-256 (intégrité vérifiable, sauvegardes légères) ;
 *  - le logo est affiché sur l'écran de connexion (avant authentification) : il est donc servi par
 *    une route PUBLIQUE en lecture seule, sans jamais exposer le chemin physique ni l'id de ligne ;
 *  - l'upload est validé par MAGIC BYTES (le mime déclaré par le navigateur est ignoré) et borné en
 *    taille ; le SVG est accepté mais ASSAINI (script, gestionnaires d'événements, références
 *    externes retirés) ET servi derrière une CSP `sandbox` — un logo ne doit pas pouvoir exécuter du
 *    code sur l'origine de l'application ;
 *  - une « révision » (empreinte courte) accompagne l'URL : le navigateur recharge l'image
 *    immédiatement après un changement, sans cache périmé ni `Ctrl+F5`.
 */
import crypto from 'node:crypto';
import { getSection, saveSection } from './settings';
import { deleteFile, putFile, readFile } from './storage';
import { sniffFile } from './security/upload';
import { getDb } from './data';
import { ApiError } from './http/errors';
import { cached, bumpTag } from './cache';
import { childLog } from './logger';

const log = childLog('branding');

export type BrandingKind = 'logo' | 'favicon';
export const BRANDING_KINDS: BrandingKind[] = ['logo', 'favicon'];

/** Tailles maximales (un logo n'a aucune raison de peser plusieurs Mo — refus net plutôt que lenteur). */
const MAX_BYTES: Record<BrandingKind, number> = { logo: 1024 * 1024, favicon: 256 * 1024 };

/** Types raster acceptés (détection par contenu, jamais par le nom ni le mime déclaré). */
const ACCEPTED_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export interface BrandingImage {
  kind: BrandingKind;
  path: string;
  rev: string;
  mime: string;
  sizeBytes: number;
  /** URL publique (route sans authentification) — à utiliser telle quelle dans un <img src> */
  url: string;
}

export interface BrandingState {
  appName: string;
  orgName: string;
  logo: BrandingImage | null;
  favicon: BrandingImage | null;
}

function imageOf(kind: BrandingKind, path: string, rev: string): BrandingImage | null {
  if (!path) return null;
  const buf = readFile(path);
  if (!buf) return null; // fichier perdu (restauration partielle) : repli sur le monogramme
  return {
    kind,
    path,
    rev: rev || sha(buf).slice(0, 12),
    mime: guessImageMime(path, buf),
    sizeBytes: buf.length,
    url: `/api/v1/branding/${kind}?v=${encodeURIComponent(rev || sha(buf).slice(0, 12))}`,
  };
}

function sha(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function guessImageMime(path: string, buf: Buffer): string {
  if (/\.svg$/i.test(path)) return 'image/svg+xml';
  return sniffFile(buf)?.mime ?? 'application/octet-stream';
}

/** État courant (nom de l'application + logo + icône) — mis en cache, invalidé à chaque changement. */
export async function brandingState(): Promise<BrandingState> {
  return cached('branding', 'state', 30_000, async () => {
    const general = (await getSection('general')) as {
      appName?: string;
      orgName?: string;
      logoPath?: string;
      logoRev?: string;
      faviconPath?: string;
      faviconRev?: string;
    };
    return {
      appName: String(general.appName ?? 'sarDPI'),
      orgName: String(general.orgName ?? ''),
      logo: imageOf('logo', String(general.logoPath ?? ''), String(general.logoRev ?? '')),
      favicon: imageOf('favicon', String(general.faviconPath ?? ''), String(general.faviconRev ?? '')),
    };
  });
}

/* ------------------------------------------------------------------ validation du contenu */

/**
 * Assainissement SVG — retrait de tout ce qui peut exécuter du code ou charger une ressource
 * extérieure : `<script>`, gestionnaires `on*=`, pseudo-protocole `javascript:`, éléments
 * d'inclusion (foreignObject/iframe/embed/object/link), `@import` et `url(http…)`.
 * Le SVG nettoyé reste un SVG valide pour un `<img>` ; en complément, la route de diffusion ajoute
 * une CSP `default-src 'none'; sandbox` (double verrou si l'URL est ouverte directement).
 */
export function sanitizeSvg(source: string): string {
  let out = source;
  // commentaires + sections CDATA (peuvent masquer du script à un filtre naïf)
  out = out.replace(/<!--[\s\S]*?-->/g, '');
  out = out.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  // Éléments supprimés (avec leur contenu) : exécution de code, inclusion de document externe, ou
  // chargement d'une ressource tierce — `<image>`/`<use>` peuvent pointer hors de l'origine et
  // `<animate>` peut faire varier un attribut href. Un logo n'a besoin d'aucun d'eux.
  const banned = 'script|foreignObject|iframe|embed|object|link|image|use|audio|video|handler';
  out = out.replace(new RegExp(`<\\s*(?:${banned})\\b[^>]*>[\\s\\S]*?<\\s*/\\s*(?:${banned})\\s*>`, 'gi'), '');
  out = out.replace(new RegExp(`<\\s*(?:${banned})\\b[^>]*\\/?\\s*>`, 'gi'), '');
  out = out.replace(/<\s*animate[^>]*attributename\s*=\s*["']?href[\s\S]*?(?:<\s*\/\s*animate\s*>|\/?>)/gi, '');
  // gestionnaires d'événements (onclick, onload, onbegin…)
  out = out.replace(/\son[a-z-]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // pseudo-protocoles et références externes (href / xlink:href / src / style url())
  out = out.replace(/(href|src)\s*=\s*(["']?)\s*(javascript|data:text\/html|https?:|\/\/)[^"'>\s]*\2/gi, '');
  out = out.replace(/@import[\s\S]*?;/gi, '');
  out = out.replace(/url\(\s*(["']?)\s*(https?:|\/\/|data:text\/html)[^)]*\)/gi, 'none');
  return out.trim();
}

function looksLikeSvg(buf: Buffer): boolean {
  const head = buf.subarray(0, Math.min(buf.length, 512)).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  return head.startsWith('<svg') || head.startsWith('<?xml');
}

/**
 * Contrôle du fichier téléversé : taille, type RÉEL (magic bytes), SVG assaini.
 * Retourne le buffer à écrire (éventuellement réécrit pour le SVG) et le mime effectif.
 */
export function validateBrandingFile(kind: BrandingKind, buf: Buffer, originalName: string): { buf: Buffer; mime: string; ext: string } {
  const max = MAX_BYTES[kind];
  if (!buf || buf.length === 0) throw new ApiError(400, 'errors.validation', 'fichier vide', { file: true });
  if (buf.length > max) throw new ApiError(413, 'errors.uploadTooLarge', undefined, { mb: Math.max(1, Math.round(max / 1024 / 1024)) });

  const isSvg = /\.svg$/i.test(originalName) && looksLikeSvg(buf);
  if (isSvg) {
    const clean = sanitizeSvg(buf.toString('utf8'));
    if (!/<svg[\s>]/i.test(clean)) throw new ApiError(400, 'errors.badFileType', 'SVG invalide', { file: true });
    const out = Buffer.from(clean, 'utf8');
    if (out.length > max) throw new ApiError(413, 'errors.uploadTooLarge', undefined, { mb: Math.max(1, Math.round(max / 1024 / 1024)) });
    return { buf: out, mime: 'image/svg+xml', ext: 'svg' };
  }

  const sniffed = sniffFile(buf);
  if (!sniffed || !ACCEPTED_MIMES.has(sniffed.mime)) {
    throw new ApiError(400, 'errors.badFileType', `type refusé pour ${kind} — PNG, JPEG, WEBP, GIF ou SVG attendu`, { file: true });
  }
  return { buf, mime: sniffed.mime, ext: sniffed.ext };
}

/* ------------------------------------------------------------------ écriture */

interface KindFields {
  pathKey: 'logoPath' | 'faviconPath';
  revKey: 'logoRev' | 'faviconRev';
}

const FIELDS: Record<BrandingKind, KindFields> = {
  logo: { pathKey: 'logoPath', revKey: 'logoRev' },
  favicon: { pathKey: 'faviconPath', revKey: 'faviconRev' },
};

/** Une ligne `assets` par type d'image (mise à jour sur place) — l'audit, lui, garde l'historique. */
async function upsertAsset(kind: BrandingKind, stored: { fileName: string; storedPath: string; mime: string; size: number; sha256: string }, actorId: number | null): Promise<void> {
  const db = await getDb();
  const existing = await db.findOne<{ id: number }>('assets', { kind, ref_table: 'settings' });
  const row = {
    file_name: stored.fileName,
    file_path: stored.storedPath,
    mime: stored.mime,
    size_bytes: stored.size,
    sha256: stored.sha256,
    uploaded_by: actorId,
    updated_at: new Date().toISOString(),
  };
  if (existing) await db.update('assets', Number(existing.id), row);
  else await db.insert('assets', { kind, ref_table: 'settings', created_at: new Date().toISOString(), ...row });
}

/** Remplace le logo (ou l'icône) : écriture du fichier, réglage mis à jour, ancien fichier supprimé. */
export async function setBrandingImage(kind: BrandingKind, buf: Buffer, originalName: string, actorId: number | null): Promise<BrandingState> {
  if (!BRANDING_KINDS.includes(kind)) throw new ApiError(400, 'errors.validation', 'type d’image inconnu', { kind });
  const checked = validateBrandingFile(kind, buf, originalName);
  const prev = (await getSection('general')) as Record<string, unknown>;
  const { pathKey, revKey } = FIELDS[kind];
  const previousPath = String(prev[pathKey] ?? '');

  // Le nom écrit est reconstruit depuis l'extension VÉRIFIÉE (le nom d'origine ne touche jamais le
  // disque) : un « logo.txt » contenant un PNG donne bien `logo-xxxx.png`, donc un mime cohérent.
  const stored = await putFile(checked.buf, `${kind}.${checked.ext}`, 'branding', kind);
  const rev = stored.sha256.slice(0, 12);
  await saveSection('general', { [pathKey]: stored.storedPath, [revKey]: rev }, actorId ?? undefined);
  await upsertAsset(kind, stored, actorId);
  if (previousPath && previousPath !== stored.storedPath) deleteFile(previousPath);
  await bumpTag('branding');
  log.info({ kind, path: stored.storedPath, size: stored.size, mime: checked.mime }, 'identité visuelle mise à jour');
  return brandingState();
}

/** Retire le logo (ou l'icône) : l'application retombe sur son monogramme / son icône par défaut. */
export async function clearBrandingImage(kind: BrandingKind, actorId: number | null): Promise<BrandingState> {
  if (!BRANDING_KINDS.includes(kind)) throw new ApiError(400, 'errors.validation', 'type d’image inconnu', { kind });
  const prev = (await getSection('general')) as Record<string, unknown>;
  const { pathKey, revKey } = FIELDS[kind];
  const previousPath = String(prev[pathKey] ?? '');
  await saveSection('general', { [pathKey]: '', [revKey]: '' }, actorId ?? undefined);
  const db = await getDb();
  const existing = await db.findOne<{ id: number }>('assets', { kind, ref_table: 'settings' });
  if (existing) await db.remove('assets', Number(existing.id));
  if (previousPath) deleteFile(previousPath);
  await bumpTag('branding');
  log.info({ kind }, 'identité visuelle retirée');
  return brandingState();
}

/** Lecture des octets pour la diffusion publique (null = aucun logo défini ou fichier absent). */
export function readBrandingImage(kind: BrandingKind, path: string): { buf: Buffer; mime: string; etag: string } | null {
  const buf = readFile(path);
  if (!buf) return null;
  const digest = sha(buf);
  return { buf, mime: guessImageMime(path, buf), etag: `"${digest.slice(0, 32)}"` };
}

/** En-têtes de diffusion d'une image d'identité (publique, non nominative, cacheable). */
export function brandingHeaders(mime: string, etag: string): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': mime,
    'cache-control': 'public, max-age=86400, stale-while-revalidate=604800',
    etag,
    'x-content-type-options': 'nosniff',
  };
  if (mime === 'image/svg+xml') {
    // Double verrou : un SVG ouvert directement dans un onglet ne peut ni charger une ressource,
    // ni exécuter de script, ni agir sur l'origine (sandbox).
    headers['content-security-policy'] = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; sandbox";
    headers['content-disposition'] = 'inline';
  }
  return headers;
}
