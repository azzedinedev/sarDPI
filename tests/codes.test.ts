/**
 * TESTS CRITÈRES — codification (Phase 1) :
 *  - séquence strictement croissante, jamais réutilisée ;
 *  - concurrency-safe (20 allocations parallèles ⇒ 20 codes uniques) ;
 *  - formats exacts : PAT-00001, GED à 6 chiffres, code combiné `{PFX}-{YYYYMMDD}-{NN}-{PAT}` ;
 *  - chiffres TOUJOURS latin (critère « codes métier LTR »).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sardpi-codes-'));
process.env.SARDPI_ROOT = tmp;
fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });

const { getDb } = await import('../apps/web/src/server/data');
const { patientCodeFromRecord, RECORD_CODE_RE, RECORD_CODE_LEGACY_RE } = await import('@sardpi/shared');
const { allocatePatientCode, allocateRecordCode, allocateSuffixed } = await import('../apps/web/src/server/codes/service');

describe('codification', () => {
  it('PAT-00001 séquentiel et jamais réutilisé (même après suppression)', async () => {
    const db = await getDb();
    const a = await allocatePatientCode();
    const b = await allocatePatientCode();
    expect(a.code).toBe('PAT-00001');
    expect(b.code).toBe('PAT-00002');
    // suppression logique du premier patient : le compteur NE REVIENT JAMAIS en arrière
    const id = await db.insert('patients', { code: a.code, first_name: 'X', last_name: 'Y', created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    await db.update('patients', id.id, { archived_at: new Date().toISOString() });
    const c = await allocatePatientCode();
    expect(c.code).toBe('PAT-00003');
  });

  it('concurrence : 20 allocations parallèles produisent 20 codes uniques (transaction + verrou)', async () => {
    const codes = await Promise.all(Array.from({ length: 20 }, () => allocatePatientCode().then((r) => r.code)));
    expect(new Set(codes).size).toBe(20);
    const nums = codes.map((c) => Number(c.split('-')[1])).sort((x, y) => x - y);
    expect(nums[nums.length - 1]! - nums[0]!).toBe(19); // contigus, sans trou
  });

  it('GED = 6 chiffres, praticien = 5 chiffres, préfixes distincts par type', async () => {
    const ged = await allocateSuffixed('ged', 'ANL');
    expect(ged.code).toMatch(/^ANL-\d{6}$/);
    const med = await allocateSuffixed('practitioner', 'MED');
    expect(med.code).toMatch(/^MED-\d{5}$/);
    const inf = await allocateSuffixed('practitioner', 'INF');
    expect(inf.code).toMatch(/^INF-\d{5}$/); // séquence indépendante par préfixe
  });

  it('code de fiche combiné {PFX}-{AAAAMMJJ}-{SEQ}-{PAT} en chiffres latins', async () => {
    const db = await getDb();
    const pat = await allocatePatientCode();
    const p = await db.insert('patients', { code: pat.code, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    const rec = await db.transaction(async (tx) => await allocateRecordCode(pat.code, p.id, 'LAB', '2026-09-30T12:00:00.000Z', tx));
    expect(rec.code).toBe(`LAB-20260930-01-${pat.code}`);
    expect(rec.code).toMatch(/^[A-Z0-9.-]+$/); // ASCII strict → jamais de chiffres arabes dans un code
    const rec2 = await db.transaction(async (tx) => await allocateRecordCode(pat.code, p.id, 'LAB', '2026-09-30T18:00:00.000Z', tx));
    expect(rec2.code).toBe(`LAB-20260930-02-${pat.code}`); // même jour → séq. 02
    const nextDay = await db.transaction(async (tx) => await allocateRecordCode(pat.code, p.id, 'LAB', '2026-10-01T08:00:00.000Z', tx));
    expect(nextDay.code).toBe(`LAB-20261001-01-${pat.code}`); // changement de jour → reset séquence
  });

  it('rétrocompatibilité : les codes de l’ancien format restent parseables (codes immuables déjà émis/encodés dans des QR)', () => {
    expect(patientCodeFromRecord('PAT-00001-20260930-LAB-01')).toBe('PAT-00001'); // ancien
    expect(patientCodeFromRecord('LAB-20260930-01-PAT-00001')).toBe('PAT-00001'); // nouveau
    expect(patientCodeFromRecord('PAT-00001')).toBeNull();
    expect(RECORD_CODE_RE.test('LAB-20260930-01-PAT-00001')).toBe(true);
    expect(RECORD_CODE_RE.test('PAT-00001-20260930-LAB-01')).toBe(false); // ancien ≠ format courant
    expect(RECORD_CODE_LEGACY_RE.test('PAT-00001-20260930-LAB-01')).toBe(true);
  });

  it('la table de séquences n’est jamais cachée : relire après bump renvoie le dernier compteur', async () => {
    const db = await getDb();
    const rows = await db.find<{ scope: string; last_value: number }>('code_sequences');
    const patientRow = rows.find((r) => r.scope.startsWith('patient'));
    expect(patientRow).toBeTruthy();
    expect(Number(patientRow!.last_value)).toBeGreaterThanOrEqual(22);
  });
});
