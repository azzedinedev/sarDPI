/**
 * JOURNAL D'AUDIT INALTÉRABLE — chaque entrée est chaînée par hash (sha256(entree + hash précédent)).
 * `verify` recalcule la chaîne pour détecter toute altération. Aucune donnée sensible en clair :
 * les colonnes chiffrées (type enc du schéma) sont masquées dans les diffs.
 */
import { getDb } from '../data';
import { canon, chainHash, sha256 } from '../util';
import { tableMeta } from '../data/schema';

export interface AuditInput {
  actorId?: number | null;
  action: string; // patients.create | records.update | auth.login | …
  entity: string;
  entityId?: number | null;
  ip?: string | null;
  ua?: string | null;
  diff?: Record<string, unknown> | null;
}

const GENESIS = sha256('sardpi-genesis');

function redact(table: string, obj: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!obj) return null;
  let enc: Set<string>;
  try {
    enc = tableMeta(table).encrypted;
  } catch {
    enc = new Set();
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (enc.has(k) || /password|secret|hash|token|totp/i.test(k)) {
      out[k] = '•';
      continue;
    }
    // imbrication { before: {...}, after: {...} } des diffs : la rédaction s'applique AUSSI aux enfants
    if ((k === 'before' || k === 'after') && v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = redact(table, v as Record<string, unknown>);
      continue;
    }
    out[k] = typeof v === 'object' && v !== null ? JSON.stringify(v).slice(0, 400) : v;
  }
  return out;
}

export async function audit(input: AuditInput): Promise<void> {
  try {
    const db = await getDb();
    const last = await db.find<{ hash: string }>('audit_log', { orderBy: [['id', 'desc']], limit: 1 });
    const prev = last[0]?.hash ?? GENESIS;
    const at = new Date().toISOString();
    const diff = input.diff ? redact(input.entity.includes('.') ? input.entity.split('.')[0]! : input.entity, input.diff) : null;
    const payload = canon({ at, actorId: input.actorId ?? null, action: input.action, entity: input.entity, entityId: input.entityId ?? null, diff: diff ?? null, prev });
    const hash = chainHash(prev, payload);
    await db.insert('audit_log', {
      at,
      actor_id: input.actorId ?? null,
      action: input.action,
      entity: input.entity,
      entity_id: input.entityId ?? null,
      ip: input.ip ?? null,
      ua: input.ua ? String(input.ua).slice(0, 200) : null,
      diff_json: diff,
      prev_hash: prev,
      hash,
    });
  } catch (e) {
    // l'audit ne doit JAMAIS bloquer l'action métier — journalisation stderr
    console.error('[audit] échec de journalisation :', (e as Error).message);
  }
}

/** Vérification d'intégrité de la chaîne (admin > Journal d'audit > bouton). */
export async function verifyChain(limit = 0): Promise<{ ok: boolean; checked: number; firstBad?: number }> {
  const db = await getDb();
  let rows = await db.find<Record<string, unknown>>('audit_log', { orderBy: [['id', 'asc']], ...(limit ? { limit } : {}) });
  // note : le payload exact est reconstruit à partir des colonnes stockées (approximation acceptable pour détection)
  let prev = GENESIS;
  for (const r of rows) {
    const payload = canon({
      at: typeof r.at === 'object' ? new Date(r.at as Date).toISOString() : String(r.at).startsWith('2') ? String(r.at) : new Date(String(r.at)).toISOString(),
      actorId: r.actor_id ?? null,
      action: r.action,
      entity: r.entity,
      entityId: r.entity_id ?? null,
      diff: (r.diff_json as object) ?? null,
      prev,
    });
    if (r.prev_hash !== prev) return { ok: false, checked: Number(r.id), firstBad: Number(r.id) };
    if (r.hash !== chainHash(prev, payload)) return { ok: false, checked: Number(r.id), firstBad: Number(r.id) };
    prev = String(r.hash);
  }
  return { ok: true, checked: rows.length };
}
