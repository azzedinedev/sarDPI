/**
 * Rate limiting en mémoire (aucune dépendance externe / pas de Redis).
 * Fenêtre glissante simple par clé (ip) + verrouillage progressif anti brute-force géré par le service auth
 * (colonnes failed_attempts / locked_until persistées, donc robuste aux rechargements PM2).
 */
import { env } from '../config';

interface Bucket {
  hits: number[];
}
const buckets = new Map<string, Bucket>();

export interface RateResult {
  ok: boolean;
  retryAfterSec: number;
  remaining: number;
}

export function rateLimit(key: string, rpm = env.rateLimitRpm, windowMs = 60_000): RateResult {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) {
    b = { hits: [] };
    buckets.set(key, b);
  }
  b.hits = b.hits.filter((t) => now - t < windowMs);
  if (b.hits.length >= rpm) {
    const oldest = b.hits[0] ?? now;
    return { ok: false, retryAfterSec: Math.ceil((windowMs - (now - oldest)) / 1000), remaining: 0 };
  }
  b.hits.push(now);
  return { ok: true, retryAfterSec: 0, remaining: rpm - b.hits.length };
}

/** Nettoyage périodique pour éviter une croissance non bornée. */
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    b.hits = b.hits.filter((t) => now - t < 120_000);
    if (!b.hits.length) buckets.delete(k);
  }
}, 120_000).unref();

/** Clé IP depuis les headers proxy (make-confiance-limitée : derrière nginx uniquement — à configurer). */
export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return (fwd.split(',')[0] ?? '').trim() || 'unknown';
  return req.headers.get('x-real-ip') ?? 'local';
}
