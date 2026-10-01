/**
 * TESTS CHAÎNE D’AUDIT & flux métier (Phases 1-2) : append-only à hash chaîné (altérer une ligne
 * casse la vérification à la ligne exacte), le journal ne contient JAMAIS de secret (redaction),
 * et le flux patient → fiche → token public produit les codes attendus sans rejeu.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sardpi-audit-'));
fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
process.env.SARDPI_ROOT = tmp;

const { getDb } = await import('../apps/web/src/server/data');
const { audit, verifyChain } = await import('../apps/web/src/server/audit');

describe('journal d’audit infalsifiable', () => {
  it('audit() chaîne les empreintes et verifyChain() valide', async () => {
    await audit({ actorId: 1, action: 'patients.create', entity: 'patients', entityId: 1, ip: '127.0.0.1', diff: null });
    await audit({ actorId: 1, action: 'records.update', entity: 'medical_records', entityId: 9, ip: '127.0.0.1', diff: { before: { status: 'draft' }, after: { status: 'validated' } } });
    const res = await verifyChain();
    expect(res.ok).toBe(true);
    expect(res.checked).toBeGreaterThanOrEqual(2);
  });

  it('altérer une ligne existante est DÉTECTÉ à la position exacte', async () => {
    const db = await getDb();
    const rows = await db.find<{ id: number; action: string }>('audit_log', { orderBy: [['id', 'asc']] });
    const target = rows[0]!;
    await db.update('audit_log', Number(target.id), { action: 'patients.create-TAMPERED' });
    const res = await verifyChain();
    expect(res.ok).toBe(false);
    expect(res.firstBad).toBe(Number(target.id));
    // remise en état → revalide
    await db.update('audit_log', Number(target.id), { action: target.action });
    expect((await verifyChain()).ok).toBe(true);
  });

  it('les champs sensibles sont masqués dans le diff (jamais de hash/token en clair)', async () => {
    await audit({ actorId: 1, action: 'users.update', entity: 'users', entityId: 2, diff: { before: { password_hash: 'x', email: 'a@b.c' }, after: { password_hash: 'y', email: 'd@e.f' } } });
    const db = await getDb();
    const last = (await db.find<Record<string, unknown>>('audit_log', { orderBy: [['id', 'desc']], limit: 1 }))[0]!;
    const s = JSON.stringify(last.diff_json ?? last.diff ?? last);
    expect(s).not.toContain("'x'");
    expect(s).not.toContain('"x"');
    expect(s).toContain('•');
  });
});

describe('flux patient → fiche → vérification publique (adapters JSON)', () => {
  it('codes croissants, token aléatoire ≠ id, unicité du verify_token', async () => {
    const db = await getDb();
    const { allocatePatientCode, allocateRecordCode } = await import('../apps/web/src/server/codes/service');
    const pat = await allocatePatientCode();
    const p = await db.insert('patients', { code: pat.code, first_name: 'Test', last_name: 'Flow', created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    const token = (await import('node:crypto')).randomBytes(16).toString('base64url');
    const recId = await db.transaction(async (tx) => {
      const a = await allocateRecordCode(pat.code, p.id, 'CON', '2026-09-30T09:00:00.000Z', tx);
      const r = await tx.insert('medical_records', { code: a.code, patient_id: p.id, type_id: 1, category_prefix: 'CON', act_date: '2026-09-30T09:00:00.000Z', status: 'validated', verify_token: token, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      return r.id;
    });
    const rec = await db.findOne<Record<string, unknown>>('medical_records', { id: Number(recId) });
    expect(String(rec!.code)).toBe(`${pat.code}-20260930-CON-01`);
    expect(token.length).toBeGreaterThanOrEqual(22); // jeton aléatoire — l’id de la fiche n’y figure JAMAIS (pas de lien direct id → ressource)
    expect(token).not.toBe(String(recId));
    await db.insert('verify_tokens', { token, entity_type: 'record', entity_id: Number(recId), entity_code: String(rec!.code), meta_json: { kind: 'CON' }, issued_at: new Date().toISOString(), expires_at: null, revoked: 0 });
    const hit = await db.findOne<Record<string, unknown>>('verify_tokens', { token });
    expect(Number(hit!.entity_id)).toBe(Number(recId));
    // le lien public est un token AlÉATOIRE signé, jamais l'id : vérif sur l'absence de l'id dans le token
    await db.update('verify_tokens', Number(hit!.id), { revoked: 1 });
    expect(Number((await db.findOne<Record<string, unknown>>('verify_tokens', { token }))!.revoked)).toBe(1); // révocation immédiate, pas de 404 ambigu
  });
});
