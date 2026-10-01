/**
 * STORAGE — fichiers hors base (GED, assets, PDF à la volée) sous storage/ + URLs signées expirantes.
 * ---------------------------------------------------------------------------
 * - En base ne vivent QUE le chemin RELATIF, le mime, la taille et le SHA-256 → intégrité vérifiable,
 *   la base reste légère (loi 18-07 : données de santé chiffrables en bloc, sauvegardes allégées).
 * - Diffusion publique : JAMAIS le chemin ni un id — un JWT signé court-lived ({f: relPath}, exp) dont
 *   /api/v1/files/:token valide signature ET expiration ; permission déjà contrôlée à l'émission.
 * - Anti-traversée : tout chemin résolu doit rester sous storage/ (path traversal refusé, 404).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { decodeJwt } from 'jose';
import { paths } from '../config';
import { signPayload, verifySigned } from '../auth/jwt';
import { childLog } from '../logger';

const log = childLog('storage');

export interface StoredFile {
  /** chemin RELATIF à storage/ (posix, traversable-safe) */
  storedPath: string;
  fileName: string;
  ext: string;
  mime: string;
  size: number;
  sha256: string;
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  json: 'application/json',
  html: 'text/html; charset=utf-8',
  xml: 'application/xml',
  zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function guessMime(name: string): string {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

/** Nom de fichier SANITAIRE : borne de longueur, plus de caractère d'path — le nom d'origine ne touche jamais le disque. */
function sanitizeHint(hint: string, originalName: string): { base: string; ext: string } {
  const rawExt = (originalName.split('.').pop() ?? '').toLowerCase();
  const ext = /^[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : 'bin';
  const clean = (hint || originalName || 'file')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 64);
  return { base: clean || 'file', ext };
}

function assertInsideStorage(relPath: string): string {
  const abs = path.resolve(paths.storage, relPath);
  const root = path.resolve(paths.storage);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('chemin hors storage/ (refusé)');
  return abs;
}

/**
 * Écrit un fichier sous storage/<subdir>/<hint>-<rand4>.<ext> (0600), retourne les métadonnées
 * (SHA-256 inclus — l'intégrité sera re-vérifiée à chaque lecture par le module consommateur).
 */
export async function putFile(buf: Buffer, originalName: string, subdir: string, hint?: string): Promise<StoredFile> {
  const safeSub = subdir
    .split('/')
    .map((p) => p.replace(/[^A-Za-z0-9._-]/g, '-'))
    .filter((p) => p && p !== '.' && p !== '..')
    .join('/');
  if (!safeSub) throw new Error('sous-répertoire de stockage invalide');
  const { base, ext } = sanitizeHint(hint ?? '', originalName);
  const rand = crypto.randomBytes(3).toString('hex');
  const fileName = `${base}-${rand}.${ext}`;
  const storedPath = `${safeSub}/${fileName}`;
  const abs = assertInsideStorage(storedPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf, { mode: 0o600 });
  return {
    storedPath,
    fileName,
    ext,
    mime: MIME_BY_EXT[ext] ?? 'application/octet-stream',
    size: buf.length,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
  };
}

/** Lecture sûre (null = absent ou hors storage/) — jamais de throw sur entrée réseau. */
export function readFile(relPath: string): Buffer | null {
  try {
    const abs = assertInsideStorage(relPath);
    if (!fs.existsSync(abs)) return null;
    return fs.readFileSync(abs);
  } catch {
    return null;
  }
}

export function sha256OfFile(relPath: string): string | null {
  const buf = readFile(relPath);
  return buf ? crypto.createHash('sha256').update(buf).digest('hex') : null;
}

/** Suppression physique (soft delete GED : on ne supprime que si la version n'est plus référencée). */
export function deleteFile(relPath: string): boolean {
  try {
    const abs = assertInsideStorage(relPath);
    if (!fs.existsSync(abs)) return false;
    fs.rmSync(abs);
    return true;
  } catch (e) {
    log.warn({ err: (e as Error).message, relPath }, 'deleteFile refusée');
    return false;
  }
}

/* ------------------------------------------------------- URLs signées */

export interface SignedFileUrl {
  /** relatif — à préfixer par APP_URL côté appelant */
  url: string;
  expiresAt: string;
}

/** Émission d'un droit de lecture TEMPORAIRE sur un fichier (la permission a été contrôlée avant). */
export async function signedFileUrl(relPath: string, ttlMin: number): Promise<SignedFileUrl> {
  const ttlSec = Math.max(30, Math.min(24 * 3600, Math.round(ttlMin * 60)));
  const token = await signPayload({ f: relPath }, ttlSec);
  return { url: `/api/v1/files/${token}`, expiresAt: new Date(Date.now() + ttlSec * 1000).toISOString() };
}

export interface ResolvedFile {
  /** '' quand expired=true (aucune information divulguée sur un token périmé) */
  relPath: string;
  /** true si le token a une structure valide mais est périmé → 410, distinct de 404 */
  expired?: boolean;
}

export async function resolveFileToken(token: string): Promise<ResolvedFile | null> {
  if (!token || token.length > 4096) return null;
  const claims = await verifySigned<{ f?: string }>(token);
  if (claims?.f) {
    try {
      assertInsideStorage(String(claims.f));
    } catch {
      return null; // token forgé hors storage/
    }
    return { relPath: String(claims.f) };
  }
  // signature valide mais expirée → jose lève ; on relit le payload (sans le faire confiance) pour
  // distinguer 410 (expiré) de 404 (inconnu) sans rien divulguer du fichier.
  try {
    const raw = decodeJwt(token) as { exp?: number; sub?: string };
    if (raw.sub === 'sardpi-signed' && raw.exp && raw.exp * 1000 < Date.now()) return { relPath: '', expired: true };
  } catch {
    /* malformé → null */
  }
  return null;
}

/** Racine physique (tests/scripts) — ne JAMAIS exposer aux clients. */
export function storageRoot(): string {
  return paths.storage;
}
