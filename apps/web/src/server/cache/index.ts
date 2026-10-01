/**
 * CACHE SERVEUR MÉMOIRE (niveau 3) — SANS REDIS.
 * - lru-cache avec TTL + borne de taille, derrière l'interface CacheAdapter {get,set,del,invalidateByTag}.
 * - Cohérence MULTI-PROCESSUS (PM2 cluster) : table `cache_versions (tag, version)`. Chaque écriture fait
 *   bumpTag(tag) (1 UPDATE) ; chaque processus poll {tag→version} toutes les CACHE_VERSION_POLL_MS et purge
 *   ses entrées périmées (comparaison de version stockée par entrée).
 * - Un RedisCacheAdapter pourra être branché plus tard : cette interface est le seul point d'entrée.
 * - RÈGLE : les compteurs de codes ne passent JAMAIS par ce cache (lecture/écriture directes sous verrou).
 */
import { LRUCache } from 'lru-cache';
import { getDb } from '../data';
import { env } from '../config';

interface Entry {
  v: unknown;
  tagVersion: number;
}

const store = new LRUCache<string, Entry>({ max: 5000, ttl: env.cacheTtlRef * 1000 });

/** versions locales des tags (rafraîchies par le poll) */
let localVersions = new Map<string, number>();
let lastPoll = 0;
let polling = false;

async function pollVersions(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastPoll < env.cachePollMs) return;
  if (polling) return;
  polling = true;
  try {
    const db = await getDb();
    if (db.demoMode) {
      // mono-processus : les bumps sont appliqués en direct, inutile de poller la table
      lastPoll = now;
      return;
    }
    const rows = await db.find('cache_versions');
    localVersions = new Map(rows.map((r) => [String(r.tag), Number(r.version)]));
    lastPoll = now;
  } catch {
    // BD injoignable : on sert le cache (dégradation douce, pas de blocage)
  } finally {
    polling = false;
  }
}

function key(tag: string, k: string): string {
  return `${tag}::${k}`;
}

export function cacheGet<T>(tag: string, k: string): T | undefined {
  const e = store.get(key(tag, k));
  if (!e) return undefined;
  const current = localVersions.get(tag) ?? 0;
  if (e.tagVersion !== current) {
    store.delete(key(tag, k));
    return undefined;
  }
  return e.v as T;
}

export function cacheSet(tag: string, k: string, value: unknown, ttlMs?: number): void {
  store.set(key(tag, k), { v: value, tagVersion: localVersions.get(tag) ?? 0 }, ttlMs ? { ttl: ttlMs } : undefined);
}

export function cacheDel(tag: string, k: string): void {
  store.delete(key(tag, k));
}

/** Purge locale + bump global (visibilité immédiate du propre process, différé pour les workers voisins). */
export async function bumpTag(tag: string): Promise<void> {
  for (const k of store.keys()) if (k.startsWith(`${tag}::`)) store.delete(k);
  const db = await getDb();
  try {
    const row = await db.findOne('cache_versions', { tag });
    if (row) await db.update('cache_versions', Number(row.id), { version: Number(row.version) + 1, updated_at: new Date().toISOString() });
    else await db.insert('cache_versions', { tag, version: 1, updated_at: new Date().toISOString() });
    localVersions.set(tag, (localVersions.get(tag) ?? 0) + 1);
  } catch {
    /* la purge locale suffit ; le prochain poll résoudra les autres workers */
  }
}

/** Helper get-or-compute avec tag TTL (utilisé par référentiels / permissions / i18n). */
export async function cached<T>(tag: string, k: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  await pollVersions();
  const hit = cacheGet<T>(tag, k);
  if (hit !== undefined) return hit;
  const v = await compute();
  cacheSet(tag, k, v, ttlMs);
  return v;
}

export function cacheStats() {
  return { size: store.size, max: 5000, tags: [...new Set([...store.keys()].map((k) => k.split('::')[0]))] };
}
