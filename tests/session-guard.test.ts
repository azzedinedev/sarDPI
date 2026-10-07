/**
 * GARDE DE SESSION — « aucun affichage sans session valide ».
 * ---------------------------------------------------------------------------------------------
 * Défaut corrigé : le jeton d'accès porte l'identifiant de session (`sid`) et reste
 * cryptographiquement valide jusqu'à son expiration (15 min par défaut). Le serveur ne vérifiait
 * PAS que la session existait encore : après une déconnexion depuis un autre appareil, une
 * révocation par l'admin ou une réinitialisation de mot de passe, le dossier patient restait
 * consultable jusqu'à l'expiration du jeton — et le client ne redirigeait jamais vers /login
 * puisque aucune requête n'échouait.
 *
 * Trois niveaux sont verrouillés ici :
 *   1. serveur : `authenticateOutcome()` refuse un jeton dont la session est absente/révoquée/
 *      expirée ou dont le compte est désactivé, avec le code dédié `auth.sessionEnded` ;
 *   2. middleware : une navigation sans cookie de session n'obtient jamais de HTML applicatif ;
 *   3. client : au premier 401 non récupérable, l'état est vidé et le navigateur part vers /login
 *      avec la page d'origine en `next` (testé dans tests/session-client.test.ts).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sardpi-session-'));
process.env.SARDPI_ROOT = tmp;
process.env.DATA_ADAPTER = 'json';
process.env.ENC_KEYS = `1:${'a'.repeat(64)}`;
process.env.AUTH_SECRET = `test-secret-${'x'.repeat(32)}`;

const { getDb } = await import('../apps/web/src/server/data');
const { authenticateOutcome, requireAuth } = await import('../apps/web/src/server/auth/guard');
const { signAccessToken } = await import('../apps/web/src/server/auth/jwt');
const { loginUrl, needsSession, redirectTarget, isAssetPath, isPublicPath } = await import('../apps/web/src/lib/session-gate');

const NOW = (): string => new Date().toISOString();
const inDays = (d: number): string => new Date(Date.now() + d * 86_400_000).toISOString();

/** Jeu minimal : un rôle, un utilisateur actif, une session vivante. */
async function seed(): Promise<{ uid: number; sid: number; sessionId: number }> {
  const db = await getDb();
  const role = await db.findOne<Record<string, unknown>>('roles', { role_key: 'admin' });
  const roleId = role
    ? Number(role.id)
    : (await db.insert('roles', { role_key: 'admin', name_json: { fr: 'Admin' }, perms_json: [], created_at: NOW(), updated_at: NOW() })).id;
  const uid = (
    await db.insert('users', {
      username: 'guard-test',
      email: 'guard@test.dz',
      full_name: 'Garde Test',
      password_hash: 'x',
      role_id: roleId,
      locale: 'fr',
      active: 1,
      created_at: NOW(),
      updated_at: NOW(),
    })
  ).id;
  const sessionId = (
    await db.insert('sessions', {
      user_id: uid,
      refresh_hash: `hash-${uid}-${Date.now()}`,
      user_agent: 'vitest',
      ip: '127.0.0.1',
      expires_at: inDays(7),
      created_at: NOW(),
    })
  ).id;
  return { uid, sid: sessionId, sessionId };
}

const bearer = (token: string): Request => new Request('http://local/api/v1/x', { headers: { authorization: `Bearer ${token}` } });

describe('serveur — la session doit être VIVANTE à chaque requête', () => {
  it('session vivante : jeton accepté, permissions résolues', async () => {
    const { uid, sid } = await seed();
    const token = await signAccessToken({ uid, sid, role: '1', locale: 'fr' });
    const res = await authenticateOutcome(bearer(token));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.user.uid).toBe(uid);
      expect(res.user.sid).toBe(sid);
      expect(res.user.active).toBe(true);
    }
  });

  it('session RÉVOQUÉE (déconnexion ailleurs, révocation admin, mot de passe réinitialisé) : refus immédiat', async () => {
    const { uid, sid } = await seed();
    const token = await signAccessToken({ uid, sid, role: '1', locale: 'fr' });
    expect((await authenticateOutcome(bearer(token))).ok).toBe(true);

    const db = await getDb();
    await db.update('sessions', sid, { revoked_at: NOW() });

    const after = await authenticateOutcome(bearer(token));
    // le jeton est toujours cryptographiquement valide : c'est bien la SESSION qui tranche
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.code).toBe('auth.sessionEnded');
    await expect(requireAuth(bearer(token))).rejects.toMatchObject({ status: 401, code: 'auth.sessionEnded' });
  });

  it('session EXPIRÉE ou INCONNUE, jeton sans session : refus', async () => {
    const { uid, sid } = await seed();
    const db = await getDb();
    await db.update('sessions', sid, { expires_at: inDays(-1) });
    const expired = await signAccessToken({ uid, sid, role: '1', locale: 'fr' });
    const res = await authenticateOutcome(bearer(expired));
    expect(res.ok).toBe(false);

    const unknown = await signAccessToken({ uid, sid: 999_999, role: '1', locale: 'fr' });
    expect((await authenticateOutcome(bearer(unknown))).ok).toBe(false);

    // jeton sans `sid` (jeton forgé/ancien client) : aucune session à révoquer ⇒ refus
    const noSid = await signAccessToken({ uid, sid: null, role: '1', locale: 'fr' });
    const resNoSid = await authenticateOutcome(bearer(noSid));
    expect(resNoSid.ok).toBe(false);
    if (!resNoSid.ok) expect(resNoSid.code).toBe('auth.sessionEnded');
  });

  it('compte DÉSACTIVÉ : la session n’ouvre plus rien (traitée comme interrompue)', async () => {
    const { uid, sid } = await seed();
    const token = await signAccessToken({ uid, sid, role: '1', locale: 'fr' });
    const db = await getDb();
    await db.update('users', uid, { active: 0 });
    const res = await authenticateOutcome(bearer(token));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('auth.sessionEnded');
  });

  it('absence de jeton : 401 générique (pas « session interrompue »)', async () => {
    const res = await authenticateOutcome(new Request('http://local/api/v1/x'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('errors.unauthorized');
  });
});

describe('middleware — porte de session (aucun HTML applicatif sans cookie)', () => {
  it('les pages applicatives exigent une session, les pages publiques et les assets non', () => {
    for (const p of ['/', '/dashboard', '/patients/12', '/admin/settings', '/records/LAB']) {
      expect(needsSession(p), p).toBe(true);
    }
    for (const p of ['/login', '/login/reset', '/forgot', '/reset-password', '/verify/QR-123', '/healthz', '/readyz']) {
      expect(needsSession(p), p).toBe(false);
      expect(isPublicPath(p), p).toBe(true);
    }
    // ressources statiques : jamais redirigées (sinon l'icône ou le manifeste pointeraient sur /login)
    for (const p of ['/icon.svg', '/manifest.webmanifest', '/fonts/ibm-plex-sans-latin-400.woff2']) {
      expect(needsSession(p), p).toBe(false);
      expect(isAssetPath(p), p).toBe(true);
    }
  });

  it('l’URL de connexion conserve la page d’origine et le motif', () => {
    expect(loginUrl('/dashboard', 'expired')).toBe('/login?next=%2Fdashboard&reason=expired');
    expect(loginUrl('/patients?q=ali', 'ended')).toBe('/login?next=%2Fpatients%3Fq%3Dali&reason=ended');
    // pas de retour vers /login lui-même (boucle), et pas d'URL externe injectée
    expect(loginUrl('/login', 'ended')).toBe('/login?reason=ended');
    expect(loginUrl('https://evil.example', 'ended')).toBe('/login?reason=ended');
    expect(loginUrl(null, undefined)).toBe('/login');
  });

  it('le client ne redirige jamais depuis une page publique, et jamais vers une URL externe', () => {
    expect(redirectTarget('/dashboard')).toBe('/login?next=%2Fdashboard&reason=ended');
    expect(redirectTarget('/patients', '?q=ali')).toBe('/login?next=%2Fpatients%3Fq%3Dali&reason=ended');
    expect(redirectTarget('/login')).toBeNull();
    expect(redirectTarget('/verify/QR-1')).toBeNull();
    expect(redirectTarget('/forgot')).toBeNull();
  });
});
