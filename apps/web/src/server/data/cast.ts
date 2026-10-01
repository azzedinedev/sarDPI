/**
 * CAST — frontière entre le JS applicatif et le stockage (adaptateurs JSON et SQL).
 *  - colonnes `*_json` : objet ↔ objet en JSON local, ↔ chaîne en SQL (MySQL JSON / PG JSONB) ;
 *    si une valeur arrive DÉJÀ sérialisée (chaîne JSON), on la normalise en objet (local) ou chaîne propre (SQL).
 *  - colonnes `enc` (chiffrées) : écriture via encryptField, lecture via decryptField — transparent pour les modules ;
 *    les valeurs déjà chiffrées (import/restauration) ne sont PAS re-chiffrées (isEncryptedValue).
 *  - booléens ↔ 1/0 (les modules peuvent passer les deux formes).
 *  - dates : ISO 8601 en interne ; format SQL natif ('YYYY-MM-DD', 'YYYY-MM-DD HH:MM:SS.mmm') à l'écriture.
 * Les colonnes inconnues du schéma sont ÉLIMINÉES (aucune donnée sauvage sur le disque / en base).
 */
import { tableMeta } from './schema';
import { decryptField, encryptField, isEncryptedValue } from '../security/crypto';
import type { Row } from './types';

function normDate(v: unknown, kind: 'dt' | 'date', sql: boolean): unknown {
  const s = v instanceof Date ? v.toISOString() : String(v);
  if (kind === 'date') return sql ? s.slice(0, 10) : s;
  if (!sql) return s;
  return s.replace('T', ' ').replace('Z', '').slice(0, 23);
}

export function serializeRow(table: string, row: Row, sql: boolean): Row {
  const meta = tableMeta(table);
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    const spec = meta.cols.get(k);
    if (!spec || v === undefined) continue;
    if (v === null) {
      out[k] = null;
      continue;
    }
    switch (spec.kind) {
      case 'json': {
        if (typeof v === 'string') {
          try {
            const parsed = JSON.parse(v) as unknown;
            out[k] = sql ? JSON.stringify(parsed) : parsed;
          } catch {
            out[k] = v;
          }
        } else out[k] = sql ? JSON.stringify(v) : v;
        break;
      }
      case 'enc': {
        const s = typeof v === 'string' ? v : JSON.stringify(v);
        out[k] = isEncryptedValue(s) ? s : (encryptField(s) ?? s);
        break;
      }
      case 'bool':
        out[k] = v === true || v === 'true' || Number(v) === 1 ? 1 : 0;
        break;
      case 'dt':
      case 'date':
        out[k] = normDate(v, spec.kind, sql);
        break;
      default:
        out[k] = v;
    }
  }
  return out;
}

export function hydrateRow(table: string, raw: Row | null | undefined): Row | null {
  if (!raw) return null;
  const meta = tableMeta(table);
  const out: Row = { ...raw };
  for (const [k, v] of Object.entries(out)) {
    const spec = meta.cols.get(k);
    if (!spec) continue;
    if (v === null || v === undefined) continue;
    if (spec.kind === 'json' && typeof v === 'string') {
      try {
        out[k] = JSON.parse(v) as unknown;
      } catch {
        /* pas du JSON : on garde la chaîne brute */
      }
      continue;
    }
    if (spec.kind === 'enc' && isEncryptedValue(v)) {
      out[k] = decryptField(v) ?? v;
      continue;
    }
    if ((spec.kind === 'dt' || spec.kind === 'date') && v instanceof Date) {
      out[k] = v.toISOString();
      continue;
    }
    if ((spec.kind === 'dt' || spec.kind === 'date') && typeof v === 'string' && v.includes(' ') && !v.includes('T')) {
      // 'YYYY-MM-DD HH:MM:SS[.mmm]' renvoyé par certains drivers → ISO
      const iso = new Date(v.replace(' ', 'T') + (v.length <= 19 ? 'Z' : 'Z')).toISOString();
      out[k] = iso;
    }
  }
  return out;
}
