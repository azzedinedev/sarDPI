/**
 * TESTS SÉCURITÉ (Phases 1/5/6) : politique de mot de passe, argon2id, AES-256-GCM (détection
 * d’altération), tokens signés (expiration + main-mise), RBAC avec jokers, TOTP.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sardpi-sec-'));
fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
process.env.SARDPI_ROOT = tmp;
// clé de chiffrement au repos + secret JWT de test
process.env.ENC_KEYS = '1:' + 'a'.repeat(64);
process.env.AUTH_SECRET = 'test-secret-' + 'x'.repeat(32);

const { passwordPolicyZ, can } = await import('@sardpi/shared');
const { hashPassword, verifyPassword } = await import('../apps/web/src/server/auth/password');
const { encryptField, decryptField, isEncryptedValue } = await import('../apps/web/src/server/security/crypto');
const { signPayload, verifySigned } = await import('../apps/web/src/server/auth/jwt');
const { newTotpSecret, totpNow, totpVerify } = await import('../apps/web/src/server/auth/totp');

describe('mots de passe', () => {
  it('politique : 10+ car., majuscule, chiffre, symbole', () => {
    expect(passwordPolicyZ.safeParse('short1!A').success).toBe(false); // trop court
    expect(passwordPolicyZ.safeParse('alllowercase1!').success).toBe(false); // pas de majuscule
    expect(passwordPolicyZ.safeParse('NoDigitsHere!!').success).toBe(false);
    expect(passwordPolicyZ.safeParse('Medecin!2026').success).toBe(true);
  });
  it('argon2id : round-trip + refus si mot de passe différent + format auto-haché', async () => {
    const h = await hashPassword('Medecin!2026');
    expect(h).not.toContain('Medecin');
    expect(await verifyPassword('Medecin!2026', h)).toBe(true);
    expect(await verifyPassword('Medecin!2027', h)).toBe(false);
  });
});

describe('chiffrement au repos (loi 18-07)', () => {
  it('AES-256-GCM round-trip, IV unique, tamper → null', () => {
    const p1 = '+213 661 45 78 12';
    const c = encryptField(p1);
    const c2 = encryptField(p1);
    expect(c).toBeTruthy();
    expect(c).not.toBe(c2); // IV aléatoire → deux chiffrés différents du même clair
    expect(isEncryptedValue(c)).toBe(true);
    expect(decryptField(c!)).toBe(p1);
    const tampered = c!.slice(0, -6) + (c!.endsWith('A') ? 'BAAAAA' : 'AAAAAA');
    expect(decryptField(tampered)).toBeNull(); // tag GCM invalide → refus, jamais de valeur partielle
  });
});

describe('tokens signés (QR/vérification/fichiers)', () => {
  it('round-trip + expiration refusée', async () => {
    const tok = await signPayload({ kind: 'verify', id: 42 }, 1800);
    const claims = await verifySigned<{ kind: string; id: number }>(tok);
    expect(claims?.kind).toBe('verify');
    expect(claims?.id).toBe(42);
    const expired = await signPayload({ kind: 'verify', id: 1 }, 1);
    await new Promise((r) => setTimeout(r, 1600));
    expect(await verifySigned(expired)).toBeNull();
  });
  it('un token altéré est rejeté', async () => {
    const tok = await signPayload({ a: 1 }, 300);
    expect(await verifySigned(tok.slice(0, -2) + 'xx')).toBeNull();
  });
});

describe('RBAC', () => {
  it('jokers module.* et *.action', () => {
    expect(can(['record.lab.*'], 'record.lab', 'create')).toBe(true);
    expect(can(['*.export'], 'patient', 'export')).toBe(true);
    expect(can(['patient.view'], 'patient', 'update')).toBe(false);
    expect(can(['*'], 'anything', 'validate')).toBe(true);
    expect(can(undefined, 'patient', 'view')).toBe(false);
  });
});

describe('TOTP (RFC 6238)', () => {
  it('le code courant valide, un code faux refuse', () => {
    const s = newTotpSecret();
    expect(totpVerify(s, totpNow(s))).toBe(true);
    expect(totpVerify(s, '000000', Date.now() + 10 * 60_000)).toBe(false); // hors fenêtre de temps
  });
});
