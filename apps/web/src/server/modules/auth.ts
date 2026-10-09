/**
 * MODULE AUTH — connexion (argon2id, verrouillage progressif, captcha configurable, 2FA TOTP optionnel),
 * refresh rotatif en cookie httpOnly, déconnexion, sessions révocables, mot de passe oublié (lien signé
 * à durée limitée via jeton aléatoire — JAMAIS d'id), activation de compte, profil, licence.
 */
import { z } from 'zod';
import { loginZ, passwordPolicyZ } from '@sardpi/shared';
import { route, type Ctx } from '../http/router';
import { ApiError } from '../http/errors';
import { hashPassword, verifyPassword, checkPolicy } from '../auth/password';
import { signAccessToken } from '../auth/jwt';
import { CSRF_COOKIE as CSRF_COOKIE_NAME, SESSION_COOKIE } from '@/lib/session-gate';

import { captchaPublicInfo, resolveProvider, verifyCaptcha } from '../security/captcha';
import { newTotpSecret, totpUri, totpVerify } from '../auth/totp';
import { getDb } from '../data';
import { env } from '../config';
import { publicToken, sha256 } from '../util';
import { getSection, saveSection } from '../settings';
import { audit } from '../audit';
import { renderTemplate, sendNow } from '../mail';
import { encryptField, decryptField } from '../security/crypto';

/**
 * Noms des cookies — source unique partagée avec le middleware et le client (lib/session-gate) :
 * la porte de session de l'edge teste le MÊME cookie que celui posé ici.
 */
const REFRESH_COOKIE = SESSION_COOKIE;
const CSRF_COOKIE = CSRF_COOKIE_NAME;

function cookieSet(name: string, value: string, maxAgeSec: number, path = '/', httpOnly = true): string {
  const secure = env.isProd && process.env.APP_URL?.startsWith('https');
  // Le cookie CSRF est lu par le client (double-submit) ⇒ non HttpOnly par nature ; ce n'est pas un secret de session.
  return `${name}=${value}; Path=${path}; Max-Age=${maxAgeSec};${httpOnly ? ' HttpOnly;' : ''} SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** Response JSON + plusieurs Set-Cookie (non supporté par l'objet headers simple). */
function jsonCookies(data: unknown, cookies: string[], status = 200): Response {
  const res = new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' } });
  for (const c of cookies) res.headers.append('set-cookie', c);
  return res;
}

/** Routes d'authentification : login / refresh / logout + amorçage CSRF + forgot / reset. */
export function registerAuth(): void {
  // GET /auth/csrf — amorçage du jeton CSRF (pré-login, forgot, reset : pas encore de cookie côté client).
  // Le jeton est un anti-CSRF double-submit publiquement lisible par le client, pas un secret de session.
  route({
    method: 'GET',
    path: '/auth/csrf',
    auth: false,
    licenseFree: true,
    async handler() {
      const csrf = publicToken(12);
      return jsonCookies({ csrfToken: csrf }, [cookieSet(CSRF_COOKIE, csrf, env.refreshTokenTtlDays * 86_400, '/', false)]);
    },
  });

  route({
    method: 'POST',
    path: '/auth/login',
    auth: false,
    csrf: false,
    licenseFree: true,
    noRate: true,
    async handler(ctx: Ctx) {
      const body = await ctx.body(loginZ);
      const security = (await getSection('security')) as { lockout: { maxAttempts: number; stepsMinutes: number[] } };
      // 1) anti brute-force par IP (fenêtre glissante stricte sur /login)
      const rl = (await import('../security/ratelimit')).rateLimit(`login:${ctx.ip}`, 12, 60_000);
      if (!rl.ok) throw new ApiError(429, 'errors.rateLimited', undefined, { seconds: rl.retryAfterSec });

      const db = await getDb();
      const u =
        (await db.findOne<Record<string, unknown>>('users', { username: body.identifier })) ??
        (await db.findOne<Record<string, unknown>>('users', { email: body.identifier }));
      if (!u) throw new ApiError(401, 'auth.invalid', undefined, { identifier: true });

      // 2) verrouillage progressif
      if (u.locked_until && new Date(String(u.locked_until)) > new Date()) {
        const mins = Math.max(1, Math.ceil((new Date(String(u.locked_until)).getTime() - Date.now()) / 60_000));
        throw new ApiError(423, 'auth.locked', undefined, { minutes: mins });
      }

      // 3) captcha selon fournisseur (interne = hébergé, aucun appel sortant obligatoire)
      const provider = await resolveProvider();
      if (provider !== 'none') {
        const okCap = await verifyCaptcha(
          { captchaId: body.captchaId, captchaValue: body.captchaValue, turnstileToken: body.turnstileToken, hcaptchaToken: body.hcaptchaToken, recaptchaToken: body.recaptchaToken },
          ctx.ip,
        );
        if (!okCap) throw new ApiError(400, 'auth.captcha');
      }

      const okPw = await verifyPassword(body.password, String(u.password_hash));
      if (!okPw) {
        const attempts = Number(u.failed_attempts ?? 0) + 1;
        const steps = security.lockout.stepsMinutes;
        const patch: Record<string, unknown> = { failed_attempts: attempts };
        if (attempts >= security.lockout.maxAttempts) {
          const mins = steps[Math.min(steps.length - 1, Math.floor(attempts / security.lockout.maxAttempts) - 1)] ?? steps[steps.length - 1];
          patch.locked_until = new Date(Date.now() + (mins ?? 1) * 60_000).toISOString();
        }
        await db.update('users', Number(u.id), patch);
        await audit({ actorId: Number(u.id), action: 'auth.login_failed', entity: 'users', entityId: Number(u.id), ip: ctx.ip });
        throw new ApiError(401, 'auth.invalid');
      }
      if (!Number(u.active)) throw new ApiError(403, 'errors.forbidden', 'compte désactivé');

      // 4) 2FA TOTP
      if (Number(u.totp_enabled)) {
        if (!body.totp) {
          return { ok: true, totpRequired: true } as unknown as Response; // l'UI redemande le code et rejoue avec totp (le mot de passe a déjà été vérifié)
        }
        const secret = decryptField(String(u.totp_secret ?? '')) ?? String(u.totp_secret ?? '');
        if (!secret || !totpVerify(secret, body.totp)) throw new ApiError(401, 'auth.invalid', undefined, { totp: true });
      }

      await db.update('users', Number(u.id), { failed_attempts: 0, locked_until: null, last_login_at: new Date().toISOString() });

      // 5) session : refresh rotatif (hash en base) + access JWT court
      const refresh = publicToken(24);
      const expiresAt = new Date(Date.now() + env.refreshTokenTtlDays * 86_400_000).toISOString();
      const session = await db.insert('sessions', {
        user_id: Number(u.id),
        refresh_hash: sha256(refresh),
        user_agent: (ctx.req.headers.get('user-agent') ?? '').slice(0, 200),
        ip: ctx.ip,
        expires_at: expiresAt,
        created_at: new Date().toISOString(),
      });
      const accessToken = await signAccessToken({ uid: Number(u.id), sid: Number(session.id), role: String(u.role_id), locale: String(u.locale ?? 'fr') });
      const csrf = publicToken(12);
      await audit({ actorId: Number(u.id), action: 'auth.login', entity: 'users', entityId: Number(u.id), ip: ctx.ip, ua: ctx.req.headers.get('user-agent') });

      return jsonCookies(
        {
          accessToken,
          csrfToken: csrf,
          user: { id: Number(u.id), username: u.username, email: u.email, fullName: u.full_name, locale: u.locale, theme: u.theme, density: u.density, nav: u.nav, mustChangePassword: Boolean(Number(u.must_change_password)) },
        },
        [cookieSet(REFRESH_COOKIE, refresh, env.refreshTokenTtlDays * 86_400), cookieSet(CSRF_COOKIE, csrf, env.refreshTokenTtlDays * 86_400, '/', false)],
      );
    },
  });

  /** POST /auth/refresh — rotation stricte : l'ancien token est marqué remplacé (réutilisation ⇒ vol → tout révoque). */
  route({
    method: 'POST',
    path: '/auth/refresh',
    auth: false,
    csrf: false,
    licenseFree: true,
    async handler(ctx: Ctx) {
      const db = await getDb();
      const token = ctx.req.cookies.get(REFRESH_COOKIE)?.value;
      const clearCookies = [cookieSet(REFRESH_COOKIE, '', 0), cookieSet(CSRF_COOKIE, '', 0, '/', false)];
      if (!token) {
        return jsonCookies({ error: { code: 'errors.unauthorized', message: 'errors.unauthorized' } }, clearCookies, 401);
      }
      const hash = sha256(token);
      const sess = await db.findOne<Record<string, unknown>>('sessions', { refresh_hash: hash });
      if (!sess) {
        // attaque de rejeu possible : purge des sessions de l'utilisateur si token remplacé connu
        const old = await db.findOne<Record<string, unknown>>('sessions', { replaced_by: hash });
        if (old) {
          await db.updateWhere('sessions', { user_id: Number(old.user_id) }, { revoked_at: new Date().toISOString() });
        }
        return jsonCookies({ error: { code: 'auth.sessionEnded', message: 'Session introuvable ou restaurée' } }, clearCookies, 401);
      }
      if (sess.revoked_at || new Date(String(sess.expires_at)) < new Date()) {
        return jsonCookies({ error: { code: 'auth.sessionEnded', message: 'Session expirée ou révoquée' } }, clearCookies, 401);
      }
      const user = await db.findOne<Record<string, unknown>>('users', { id: Number(sess.user_id) });
      if (!user || !Number(user.active)) {
        return jsonCookies({ error: { code: 'auth.sessionEnded', message: 'Compte utilisateur inactif' } }, clearCookies, 401);
      }

      const fresh = publicToken(24);
      const newSess = await db.insert('sessions', {
        user_id: Number(user.id),
        refresh_hash: sha256(fresh),
        user_agent: String(sess.user_agent ?? ''),
        ip: ctx.ip,
        expires_at: new Date(Date.now() + env.refreshTokenTtlDays * 86_400_000).toISOString(),
        created_at: new Date().toISOString(),
      });
      await db.update('sessions', Number(sess.id), { revoked_at: new Date().toISOString(), replaced_by: sha256(fresh) });
      const accessToken = await signAccessToken({ uid: Number(user.id), sid: Number(newSess.id), role: String(user.role_id), locale: String(user.locale ?? 'fr') });
      const csrf = publicToken(12);
      return jsonCookies({ accessToken, csrfToken: csrf }, [cookieSet(REFRESH_COOKIE, fresh, env.refreshTokenTtlDays * 86_400), cookieSet(CSRF_COOKIE, csrf, env.refreshTokenTtlDays * 86_400, '/', false)]);
    },
  });

  /** POST /auth/logout */
  route({
    method: 'POST',
    path: '/auth/logout',
    auth: false,
    licenseFree: true,
    async handler(ctx: Ctx) {
      const db = await getDb();
      const token = ctx.req.cookies.get(REFRESH_COOKIE)?.value;
      if (token) await db.updateWhere('sessions', { refresh_hash: sha256(token) }, { revoked_at: new Date().toISOString() });
      return jsonCookies({ ok: true }, [cookieSet(REFRESH_COOKIE, '', 0), cookieSet(CSRF_COOKIE, '', 0, '/', false)]);
    },
  });

  /** GET /auth/me — identité + permissions effectives (matrice UI). */
  route({
    method: 'GET',
    path: '/auth/me',
    async handler(ctx: Ctx) {
      const user = ctx.user!;
      const db = await getDb();
      const full = await db.findOne<Record<string, unknown>>('users', { id: user.uid });
      const roles = await db.find('roles');
      const lic = await getSection('license');
      return {
        user: {
          id: user.uid,
          username: user.username,
          email: user.email,
          fullName: user.fullName,
          locale: String(full?.locale ?? 'fr'),
          theme: full?.theme ?? null,
          density: full?.density ?? null,
          nav: full?.nav ?? null,
          photoAssetId: full?.photo_asset_id ?? null,
          totpEnabled: Boolean(Number(full?.totp_enabled)),
        },
        role: { id: user.roleId, key: user.roleKey, name: roles.find((r) => Number(r.id) === user.roleId)?.name_json ?? null },
        perms: user.perms,
        license: lic,
      };
    },
  });

  /** PATCH /auth/me — préférences UI persistantes (thème, langue, densité, nav). */
  route({
    method: 'PATCH',
    path: '/auth/me',
    async handler(ctx: Ctx) {
      const input = await ctx.body(
        z.object({ locale: z.enum(['ar', 'fr', 'es', 'en']).optional(), theme: z.string().max(40).optional().nullable(), density: z.enum(['comfortable', 'compact']).optional(), nav: z.enum(['sidebar', 'topbar']).optional(), fullName: z.string().max(120).optional(), photoAssetId: z.number().int().positive().optional().nullable() }),
      );
      const patch: Record<string, unknown> = {};
      if (input.locale !== undefined) patch.locale = input.locale;
      if (input.theme !== undefined) patch.theme = input.theme;
      if (input.density !== undefined) patch.density = input.density;
      if (input.nav !== undefined) patch.nav = input.nav;
      if (input.fullName !== undefined) patch.full_name = input.fullName;
      if (input.photoAssetId !== undefined) patch.photo_asset_id = input.photoAssetId;
      await ctx.db.update('users', ctx.user!.uid, patch);
      return { ok: true };
    },
  });

  /** POST /auth/password — changement par l'utilisateur connecté. */
  route({
    method: 'POST',
    path: '/auth/password',
    async handler(ctx: Ctx) {
      const input = await ctx.body(z.object({ current: z.string().min(1).max(128), next: passwordPolicyZ }));
      const db = await getDb();
      const u = await db.findOne<Record<string, unknown>>('users', { id: ctx.user!.uid });
      if (!u || !(await verifyPassword(input.current, String(u.password_hash)))) throw new ApiError(400, 'auth.invalid', undefined, { current: true });
      await db.update('users', Number(u.id), { password_hash: await hashPassword(input.next), must_change_password: 0 });
      await audit({ actorId: ctx.user!.uid, action: 'auth.password_changed', entity: 'users', entityId: Number(u.id), ip: ctx.ip });
      return { ok: true };
    },
  });

  /**
   * GET /auth/captcha — défi affiché par l'écran de connexion, selon le fournisseur EFFECTIF.
   * Renvoie soit le défi interne (id + SVG + question), soit la clé PUBLIQUE du fournisseur externe
   * (`hcaptcha` / `turnstile` / `recaptcha`) que la page utilise pour monter son widget. En cas de
   * clés manquantes, la résolution retombe sur l'interne (`fallback: true`) : la connexion reste
   * possible et l'écran peut signaler la configuration incomplète.
   */
  route({
    method: 'GET',
    path: '/auth/captcha',
    auth: false,
    licenseFree: true,
    async handler() {
      return await captchaPublicInfo();
    },
  });

  /** POST /auth/forgot — lien signé aléatoire (jeton en base, TTL 1 h) + e-mail (SMTP ou outbox). */
  route({
    method: 'POST',
    path: '/auth/forgot',
    auth: false,
    csrf: false,
    licenseFree: true,
    noRate: true,
    async handler(ctx: Ctx) {
      const rl = (await import('../security/ratelimit')).rateLimit(`forgot:${ctx.ip}`, 6, 300_000);
      if (!rl.ok) throw new ApiError(429, 'errors.rateLimited', undefined, { seconds: rl.retryAfterSec });
      const input = await ctx.body(z.object({ identifier: z.string().max(120), lang: z.enum(['ar', 'fr', 'es', 'en']).optional() }));
      const db = await getDb();
      const u = (await db.findOne<Record<string, unknown>>('users', { email: input.identifier })) ?? (await db.findOne<Record<string, unknown>>('users', { username: input.identifier }));
      // réponse identique que le compte existe ou non (anti-énumération)
      if (u) {
        const token = publicToken(20);
        await db.insert('verify_tokens', {
          token,
          entity_type: 'user_reset',
          entity_id: Number(u.id),
          entity_code: `USR-${u.id}`,
          meta_json: { purpose: 'reset' },
          issued_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          revoked: 0,
        });
        const lang = input.lang ?? String(u.locale ?? 'fr');
        const url = `${env.appUrl}/reset-password?token=${token}`;
        const tpl = renderTemplate('password_reset', lang, { url });
        await sendNow({ to: String(u.email), toName: String(u.full_name), subject: tpl.subject, bodyText: tpl.body, lang: String(lang), createdBy: null });
      }
      return { ok: true, sent: true };
    },
  });

  /** POST /auth/reset — consomme le jeton (à usage unique). */
  route({
    method: 'POST',
    path: '/auth/reset',
    auth: false,
    csrf: false,
    licenseFree: true,
    async handler(ctx: Ctx) {
      const input = await ctx.body(z.object({ token: z.string().min(10).max(64), password: passwordPolicyZ }));
      const db = await getDb();
      const vt = await db.findOne<Record<string, unknown>>('verify_tokens', { token: input.token, entity_type: 'user_reset' });
      if (!vt || Number(vt.revoked)) throw new ApiError(400, 'auth.resetInvalid');
      if (vt.expires_at && new Date(String(vt.expires_at)) < new Date()) throw new ApiError(400, 'auth.resetInvalid');
      await db.update('verify_tokens', Number(vt.id), { revoked: 1 });
      await db.update('users', Number(vt.entity_id), { password_hash: await hashPassword(input.password), failed_attempts: 0, locked_until: null, must_change_password: 0 });
      await db.updateWhere('sessions', { user_id: Number(vt.entity_id) }, { revoked_at: new Date().toISOString() }); // tous les appareils déconnectés
      await audit({ actorId: Number(vt.entity_id), action: 'auth.password_reset', entity: 'users', entityId: Number(vt.entity_id), ip: ctx.ip });
      return { ok: true };
    },
  });

  /** GET /auth/sessions + POST /auth/sessions/revoke */
  route({
    method: 'GET',
    path: '/auth/sessions',
    async handler(ctx: Ctx) {
      const db = await getDb();
      const rows = await db.find<Record<string, unknown>>('sessions', { where: { user_id: ctx.user!.uid }, orderBy: [['id', 'desc']], limit: 50 });
      return {
        rows: rows.map((s) => ({
          id: Number(s.id),
          current: Number(s.id) === ctx.user!.sid,
          ua: s.user_agent ?? '',
          ip: s.ip ?? '',
          created: s.created_at ?? null,
          revoked: Boolean(s.revoked_at),
          expiresAt: s.expires_at,
        })),
      };
    },
  });

  route({
    method: 'POST',
    path: '/auth/sessions/revoke',
    audit: { action: 'auth.sessions_revoke', entity: 'sessions' },
    async handler(ctx: Ctx) {
      const input = await ctx.body(z.object({ ids: z.array(z.number().int()).max(100).default([]), allOthers: z.boolean().default(false) }));
      const db = await getDb();
      const at = new Date().toISOString();
      if (input.allOthers) {
        const me = await db.findOne<Record<string, unknown>>('sessions', { id: ctx.user!.sid });
        await db.updateWhere('sessions', { user_id: ctx.user!.uid }, { revoked_at: at });
        if (me) await db.update('sessions', Number(me.id), { revoked_at: null });
        // recréer un token frais pour la session courante
        const fresh = publicToken(24);
        const newSess = await db.insert('sessions', { user_id: ctx.user!.uid, refresh_hash: sha256(fresh), user_agent: String(me?.user_agent ?? ''), ip: ctx.ip, expires_at: new Date(Date.now() + env.refreshTokenTtlDays * 86_400_000).toISOString(), created_at: new Date().toISOString() });
        // Jeton rattaché à la NOUVELLE session : sans `sid`, il ne serait révocable par personne et
        // la garde de session (guard.authenticateOutcome) le refuserait aussitôt.
        const accessToken = await signAccessToken({ uid: ctx.user!.uid, sid: Number(newSess.id), role: ctx.user!.role, locale: ctx.user!.locale });
        return jsonCookies({ ok: true, accessToken, rotate: true }, [cookieSet(REFRESH_COOKIE, fresh, env.refreshTokenTtlDays * 86_400)]);
      }
      for (const id of input.ids) await db.updateWhere('sessions', { id, user_id: ctx.user!.uid }, { revoked_at: at });
      return { ok: true };
    },
  });

  /** 2FA : setup renvoie secret+QR (le QR est une data URL); confirm active. */
  route({
    method: 'POST',
    path: '/auth/totp/setup',
    async handler(ctx: Ctx) {
      const secret = newTotpSecret();
      const db = await getDb();
      const enc = encryptField(secret) ?? secret;
      await db.update('users', ctx.user!.uid, { totp_secret: enc });
      const { qrSvg } = await import('../qr');
      const svg = await qrSvg(totpUri(secret, 'sarDPI', ctx.user!.email));
      return { secret, svg };
    },
  });

  route({
    method: 'POST',
    path: '/auth/totp/confirm',
    async handler(ctx: Ctx) {
      const input = await ctx.body(z.object({ code: z.string().regex(/^\d{6}$/), disable: z.boolean().optional() }));
      const db = await getDb();
      const u = await db.findOne<Record<string, unknown>>('users', { id: ctx.user!.uid });
      if (!u) throw new ApiError(404, 'errors.notFound');
      if (input.disable) {
        await db.update('users', ctx.user!.uid, { totp_enabled: 0, totp_secret: null });
        return { ok: true, enabled: false };
      }
      const secret = decryptField(String(u.totp_secret ?? '')) ?? String(u.totp_secret ?? '');
      if (!secret || !totpVerify(secret, input.code)) throw new ApiError(400, 'auth.invalid', undefined, { totp: true });
      await db.update('users', ctx.user!.uid, { totp_enabled: 1 });
      return { ok: true, enabled: true };
    },
  });

  /** GET /auth/license — état de licence pour l'UI (bandeau). */
  route({
    method: 'GET',
    path: '/auth/license',
    auth: false,
    licenseFree: true,
    async handler() {
      const lic = await getSection('license');
      const state = (lic as { state: string }).state;
      const expiresAt = (lic as { expiresAt?: string }).expiresAt;
      const expired = expiresAt ? new Date(expiresAt) < new Date() : false;
      return { state: state === 'valid' && expired ? 'expired' : state, expiresAt };
    },
  });

  /** POST /admin/license — activation d'une clé (format sarDPI-XXXX ; signature locale = hachage, aucune dépendance cloud). */
  route({
    method: 'POST',
    path: '/admin/license/activate',
    perm: ['licence', 'update'],
    async handler(ctx: Ctx) {
      const input = await ctx.body(z.object({ key: z.string().min(8).max(200) }));
      // Démo on-premise : clé structurellement valide = acceptée ; la vraie signature (RSA) est documentée en phase 6.
      const m = /^sardpi-([a-z0-9]+)-(\d{8})$/i.exec(input.key.trim());
      const parsed = m ? { org: m[1], expiresAt: `${m[2]!.slice(0, 4)}-${m[2]!.slice(4, 6)}-${m[2]!.slice(6, 8)}` } : null;
      const state = parsed ? (new Date(parsed.expiresAt) < new Date() ? 'expired' : 'valid') : 'invalid';
      await saveSection('license', { key: input.key.trim(), state, expiresAt: parsed?.expiresAt, maxUsers: 200 }, ctx.user!.uid);
      return { ok: true, state };
    },
  });

}
