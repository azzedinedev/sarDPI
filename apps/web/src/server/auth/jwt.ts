/**
 * Tokens : access JWT court (HS256, en mémoire côté client — jamais en localStorage) +
 * refresh opaque rotatif (cookie httpOnly) dont SEUL le hash vit en base.
 */
import { SignJWT, jwtVerify } from 'jose';
import { env } from '../config';

const secret = () => new TextEncoder().encode(env.authSecret);

export interface AccessClaims {
  uid: number;
  sid: number | null;
  role: string;
  locale: string;
}

export function ttlSeconds(ttl: string): number {
  const m = /^(\d+)([smhd])$/.exec(ttl);
  if (!m) return 15 * 60;
  return Number(m[1]) * { s: 1, m: 60, h: 3600, d: 86400 }[m[2] as 's' | 'm' | 'h' | 'd'];
}

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setIssuer('sardpi')
    .setExpirationTime(`${Math.floor(ttlSeconds(env.accessTokenTtl))}s`)
    .sign(secret());
}

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: 'sardpi' });
    if (!payload.uid) return null;
    return { uid: Number(payload.uid), sid: payload.sid == null ? null : Number(payload.sid), role: String(payload.role ?? ''), locale: String(payload.locale ?? 'fr') };
  } catch {
    return null;
  }
}

/** Signature du lien de vérification QR / URL signée de fichier (token stocké, mais TTL + payload signés). */
export async function signPayload(payload: Record<string, unknown>, ttlSec: number): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('sardpi-signed')
    .setExpirationTime(`${ttlSec}s`)
    .sign(secret());
}

export async function verifySigned<T extends Record<string, unknown>>(jwt: string): Promise<T | null> {
  try {
    const { payload } = await jwtVerify(jwt, secret(), { subject: 'sardpi-signed' });
    delete payload.iat;
    delete payload.exp;
    return payload as T;
  } catch {
    return null;
  }
}
