/**
 * Hachage des mots de passe : ARGON2id (hash-wasm, WASM pur — aucune compilation native, compatible Electron/on-premise).
 * Paramètres OWASP : m=64 MiB, t=3, p=1, sel 16 octets. Format stocké : $argon2id$v=19$m=65536,t=3,p=1$salt$hash (base64 sans padding).
 */
import { argon2id, argon2Verify } from 'hash-wasm';
import { randomBytes } from 'node:crypto';

const B64 = (buf: Uint8Array) => Buffer.from(buf).toString('base64').replace(/=+$/, '');
const UNB64 = (s: string) => Buffer.from(s, 'base64');

export const PASSWORD_MIN = 10;
export function checkPolicy(pw: string): string | null {
  if (pw.length < PASSWORD_MIN) return 'password.minLength';
  if (!/[A-Z]/.test(pw)) return 'password.uppercase';
  if (!/\d/.test(pw)) return 'password.digit';
  if (!/[\W_]/.test(pw)) return 'password.symbol';
  return null;
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await argon2id({ password: pw, salt, parallelism: 1, iterations: 3, memorySize: 64 * 1024, hashLength: 32, outputType: 'binary' });
  return `$argon2id$v=19$m=65536,t=3,p=1$${B64(salt)}$${B64(hash)}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$');
    if (parts.length !== 6) return false;
    const params = parts[3]!;
    const m = /^m=(\d+),t=(\d+),p=(\d+)$/.exec(params);
    if (!m) return false;
    const salt = UNB64(parts[4]!);
    const hash = UNB64(parts[5]!);
    // re-calcul avec les paramètres du hash stocké (compat. future montée des paramètres)
    const cand = await argon2id({ password: pw, salt, parallelism: Number(m[3]), iterations: Number(m[2]), memorySize: Number(m[1]), hashLength: hash.length, outputType: 'binary' });
    if (cand.length !== hash.length) return false;
    // comparaison temps constant
    let diff = 0;
    for (let i = 0; i < cand.length; i++) diff |= (cand[i] as number) ^ (hash[i] as number);
    return diff === 0;
  } catch {
    return false;
  }
}

/** @deprecated réservé tests — hash-wasm expose verify pour les formats standards ; on garde le nôtre. */
export async function argon2VerifyCompat(encoded: string, pw: string): Promise<boolean> {
  return argon2Verify({ password: pw, hash: encoded });
}
