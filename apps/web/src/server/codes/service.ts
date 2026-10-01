/**
 * SERVICE DE CODIFICATION (§6) — générateur unique des codes métier.
 * Règles appliquées :
 *  - génération CÔTÉ SERVEUR uniquement, dans une transaction ;
 *  - verrou `SELECT ... FOR UPDATE` sur code_sequences (MySQL/Postgres) → AUCUN doublon sous concurrence ;
 *  - compteur continu, SANS remise à zéro pour le patient ; padding extensible automatiquement (PAT-100000) ;
 *  - code immuable, jamais réutilisé ; UNIQUE en base en dernière ligne de défense ;
 *  - JAMAIS de cache sur les compteurs.
 * Les adapters JSON/memory (mono-processus) sérialisent l'accès par leur verrou d'écriture — même garantie dans le processus.
 */
import { buildPatientCode, buildRecordCode, buildSuffixedCode, compactDate, type CodificationConfig } from '@sardpi/shared';
import { getDb } from '../data';
import type { DataAdapter } from '../data/types';
import { getCodification } from '../settings';
import { env } from '../config';

export interface CodeAllocation {
  seq: number;
  code: string;
}

/** Courant montant + incrémentation sous verrou, dans la transaction fournie (ou une nouvelle). */
async function bumpSequence(tx: DataAdapter, scope: string, prefix: string, periodKey: string): Promise<number> {
  const rows = await tx.find<{ id: number; last_value: number | string }>('code_sequences', {
    where: { scope, prefix, period_key: periodKey },
    forUpdate: true,
  });
  const existing = rows[0];
  if (existing) {
    const next = Number(existing.last_value) + 1;
    await tx.update('code_sequences', Number(existing.id), { last_value: next, updated_at: new Date().toISOString() });
    return next;
  }
  try {
    await tx.insert('code_sequences', { scope, prefix, period_key: periodKey, last_value: 1, updated_at: new Date().toISOString() });
    return 1;
  } catch {
    // course d'insertion (index unique ux_codeseq) : relire et incrémenter
    const retry = await tx.find<{ id: number; last_value: number | string }>('code_sequences', { where: { scope, prefix, period_key: periodKey }, forUpdate: true });
    const row = retry[0]!;
    const next = Number(row.last_value) + 1;
    await tx.update('code_sequences', Number(row.id), { last_value: next, updated_at: new Date().toISOString() });
    return next;
  }
}

async function allocate(tx: DataAdapter, scope: string, prefix: string, periodKey: string, padding: number, build: (seq: number) => string): Promise<CodeAllocation> {
  const seq = await bumpSequence(tx, scope, prefix, periodKey);
  return { seq, code: build(seq) };
}

/** PAT-00001 — scope global (ou par clinique si multi-clinique activé). */
export async function allocatePatientCode(tx?: DataAdapter, clinicId: number | null = null, cfg: CodificationConfig | null = null): Promise<CodeAllocation> {
  const cod = cfg ?? (await getCodification());
  const scope = `patient:global${clinicId ? `:c${clinicId}` : ''}`;
  const run = async (t: DataAdapter) => allocate(t, scope, cod.patientPrefix, 'all', cod.patientPadding, (seq) => buildPatientCode(seq, cod));
  if (tx) return run(tx);
  const db = await getDb();
  return db.transaction(run);
}

/**
 * Code combiné de fiche médicale : PAT-00001-20260930-LAB-01.
 * SEQ propre à (patient, date de l'acte, préfixe catégorie) — anti-collision.
 * `dateInput` : date/heure locale ISO ; convertie en date du fuseau du profil pays.
 */
export async function allocateRecordCode(
  patientCode: string,
  patientId: number,
  catPrefix: string,
  dateInput: string,
  tx?: DataAdapter,
  cfg: CodificationConfig | null = null,
): Promise<CodeAllocation & { dateCompact: string }> {
  const cod = cfg ?? (await getCodification());
  const d = new Date(dateInput.length <= 10 ? `${dateInput}T12:00:00` : dateInput);
  const dateCompact = compactDate(Number.isNaN(d.getTime()) ? new Date() : d, env.timezone, cod.datePattern);
  const scope = `record:${patientId}:${dateCompact}:${catPrefix}`;
  const run = async (t: DataAdapter) => {
    const r = await allocate(t, scope, catPrefix, 'all', cod.recordSeqPadding, (seq) => buildRecordCode(patientCode, dateCompact, catPrefix, seq, cod));
    return { ...r, dateCompact };
  };
  if (tx) return run(tx);
  const db = await getDb();
  return db.transaction(run);
}

/** Codes « {PFX}-{NNNNNN} » : GED (par préfixe de type), intervenants (par type), lieux, rdv, messages… */
export type SuffixedKind = 'ged' | 'practitioner' | 'location' | 'appointment' | 'movement' | 'message' | 'drug' | 'template' | 'case';

const PADDING_FOR: Record<SuffixedKind, keyof CodificationConfig> = {
  ged: 'gedPadding',
  practitioner: 'practitionerPadding',
  location: 'locationPadding',
  appointment: 'genericPadding',
  movement: 'genericPadding',
  message: 'genericPadding',
  drug: 'patientPadding',
  template: 'genericPadding',
  case: 'genericPadding',
};

export async function allocateSuffixed(kind: SuffixedKind, prefix: string, tx?: DataAdapter): Promise<CodeAllocation> {
  const cod = await getCodification();
  const padding = Number(cod[PADDING_FOR[kind]] ?? 5);
  const scope = `${kind}:${prefix}`;
  const run = async (t: DataAdapter) => allocate(t, scope, prefix, 'all', padding, (seq) => buildSuffixedCode(prefix, seq, padding, cod.separator));
  if (tx) return run(tx);
  const db = await getDb();
  return db.transaction(run);
}

/** Vérification d'unicité préventive avant commit (UI « aperçu » du format). */
export async function peekPatientCode(): Promise<string> {
  const db = await getDb();
  const cod = await getCodification();
  const row = await db.findOne<{ last_value: number | string }>('code_sequences', { scope: 'patient:global', prefix: cod.patientPrefix, period_key: 'all' });
  return buildPatientCode(Number(row?.last_value ?? 0) + 1, cod);
}

export { getCodification };
