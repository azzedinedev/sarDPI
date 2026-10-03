/**
 * TOTP RFC 6238 (2FA) — 30 s, SHA1, 6 chiffres, fenêtre ±1. Zéro dépendance.
 * L'URI otpauth:// est encodée en QR par le module QR du client (page profil).
 */
import { createHmac, randomBytes } from 'node:crypto';
import { base32, base32Decode } from '../util';

export function newTotpSecret(): string {
  return base32(randomBytes(20), 32).replace(/=/g, '');
}

function hotp(key: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter & 0xffffffff, 4);
  const digest = createHmac('sha1', key).update(buf).digest();
  const off = digest[digest.length - 1]! & 0x0f;
  const val = ((digest[off]! & 0x7f) << 24) | (digest[off + 1]! << 16) | (digest[off + 2]! << 8) | digest[off + 3]!;
  return String(val % 1_000_000).padStart(6, '0');
}

export function totpNow(secretB32: string, at: number = Date.now()): string {
  return hotp(base32Decode(secretB32), Math.floor(at / 30_000));
}

export function totpVerify(secretB32: string, code: string, at: number = Date.now(), window = 1): boolean {
  const c = Math.floor(at / 30_000);
  for (let i = -window; i <= window; i++) {
    if (hotp(base32Decode(secretB32), c + i) === code) return true;
  }
  return false;
}

export function totpUri(secretB32: string, issuer: string, account: string): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
