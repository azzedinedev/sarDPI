/** Petits utilitaires transverses (sans dépendance). */
import { createHash, randomBytes } from 'node:crypto';

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function rng(bytes = 18): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(s: string | Buffer): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Base32 (RFC 4648) pour les secrets TOTP. */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buf: Buffer, len = 16): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out.padEnd(len, '=');
}
export function base32Decode(s: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of s.toUpperCase().replace(/=+$/, '')) {
    const idx = B32.indexOf(c);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Nettoie un nom de fichier (uploads) : pas de chemin, pas de caractères dangereux. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const clean = base.replace(/[^\w\-. ÉÀÂÇÉÈÊÎÏÔÙÛÜéàâçéèêîïôùûüأ-ي؀-ۿ]+/g, '_').slice(0, 120);
  return clean || 'file';
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parseJsonSafe<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v !== 'string') return (v as T) ?? fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

/** Diff superficiel avant/après pour l'audit (aucune valeur sensible chiffrée exposée). */
export function shallowDiff(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  for (const k of keys) {
    const av = JSON.stringify(a?.[k] ?? null);
    const bv = JSON.stringify(b?.[k] ?? null);
    if (av !== bv) out[k] = { from: a?.[k] ?? null, to: b?.[k] ?? null };
  }
  return out;
}

/** Chaîne de hachage (journal d'audit inaltérable). */
export function chainHash(prevHash: string, payload: string): string {
  return sha256(`${prevHash}|${payload}`);
}

/** Encode un token opaque lisible (QR, liens publics) — jamais un id. */
export function publicToken(bytes = 16): string {
  return randomBytes(bytes).toString('base64url');
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Formate dans le fuseau du profil pays (sans dépendance tz). */
export function zonedParts(d: Date | string, tz: string) {
  const date = typeof d === 'string' ? new Date(d) : d;
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const g = (t: Intl.DateTimeFormatPartTypes) => fmt.formatToParts(date).find((p) => p.type === t)?.value ?? '00';
  return { y: g('year'), m: g('month'), d: g('day'), hh: g('hour') === '24' ? '00' : g('hour'), mm: g('minute'), ss: g('second') };
}

/** 'YYYY-MM-DD' local au fuseau donné. */
export function zonedDate(d: Date | string, tz: string): string {
  const p = zonedParts(d, tz);
  return `${p.y}-${p.m}-${p.d}`;
}

/** 'YYYY-MM-DDTHH:mm' local au fuseau donné (bornes calendrier, codes). */
export function zonedDateTime(d: Date | string, tz: string): string {
  const p = zonedParts(d, tz);
  return `${p.y}-${p.m}-${p.d}T${p.hh}:${p.mm}`;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Sérialisation canonique (clés triées récursivement) — hachages reproductibles. */
export function canon(v: unknown): string {
  const walk = (x: unknown): unknown => {
    if (x === null || x === undefined) return null;
    if (Array.isArray(x)) return x.map(walk);
    if (x instanceof Date) return x.toISOString();
    if (typeof x === 'object') {
      const o = x as Record<string, unknown>;
      const keys = Object.keys(o).sort();
      const out: Record<string, unknown> = {};
      for (const k of keys) out[k] = walk(o[k]);
      return out;
    }
    return x;
  };
  return JSON.stringify(walk(v));
}
