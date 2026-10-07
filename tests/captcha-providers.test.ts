/**
 * CAPTCHA — le défi AFFICHÉ doit être celui qui est VÉRIFIÉ, et un fournisseur externe mal configuré
 * ne doit jamais rendre la connexion impossible.
 * ---------------------------------------------------------------------------------------------
 * Défaut corrigé (rapporté en usage réel) : après avoir choisi « hCaptcha » dans Paramètres › Captcha
 * sans clés, l'écran de connexion n'affichait AUCUN défi (la page ne savait monter que le captcha
 * interne) alors que le serveur exigeait un jeton hCaptcha → `POST /auth/login` répondait
 * systématiquement 400 `auth.captcha` : plus personne ne pouvait se connecter, administrateur compris.
 *
 * Sont verrouillés ici :
 *   1. la résolution unique (`resolveCaptcha`) : fournisseur EFFECTIF, clés (Paramètres prioritaire,
 *      sinon variables d'environnement), repli interne si une clé manque ;
 *   2. la charge utile publique `/auth/captcha` : clé publique uniquement, défi interne quand c'est
 *      l'interne, jamais de secret ;
 *   3. la cohérence écran ↔ vérification : la vérification externe utilise la clé résolue ;
 *   4. le côté navigateur : champ de jeton, script du widget, charge utile de connexion ;
 *   5. le formulaire Paramètres : un fournisseur externe sans clés est refusé (avec un code traduit).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sardpi-captcha-'));
process.env.SARDPI_ROOT = tmp;
process.env.DATA_ADAPTER = 'json';
process.env.ENC_KEYS = `1:${'a'.repeat(64)}`;
process.env.AUTH_SECRET = `test-secret-${'x'.repeat(32)}`;

const { getDb } = await import('../apps/web/src/server/data');
const { resolveCaptcha, captchaPublicInfo, verifyCaptcha } = await import('../apps/web/src/server/security/captcha');
const { saveSection, getSection } = await import('../apps/web/src/server/settings');
const { cacheDel } = await import('../apps/web/src/server/cache');
const { captchaPayload, captchaTokenField, captchaScriptUrl, captchaGlobalName, captchaNeedsToken } = await import('../apps/web/src/lib/captcha-client');
const { issuesByPath } = await import('../apps/web/src/lib/settings-fields');

/** Enregistre la section captcha telle que le ferait l'écran Paramètres (secret masqué réécrit à ""). */
async function setCaptcha(value: Record<string, unknown>): Promise<void> {
  await saveSection('captcha', value);
}

describe('résolution unique du fournisseur', () => {
  beforeEach(async () => {
    const db = await getDb();
    await db.removeWhere('settings', { key: 'captcha' });
    cacheDel('settings', 'settings:captcha');
    delete process.env.HCAPTCHA_SITEKEY;
    delete process.env.HCAPTCHA_SECRET;
    delete process.env.TURNSTILE_SITEKEY;
    delete process.env.TURNSTILE_SECRET;
  });

  it('interne : le défi est auto-hébergé, aucune clé requise', async () => {
    await setCaptcha({ provider: 'internal' });
    const res = await resolveCaptcha();
    expect(res).toMatchObject({ requested: 'internal', provider: 'internal', configured: true, fallback: false });
    const info = await captchaPublicInfo();
    expect(info.provider).toBe('internal');
    expect(info.svg).toContain('<svg');
    expect(info.question).toMatch(/^\d+ \+ \d+$/);
    expect(info.sitekey).toBeNull();
  });

  it('hCaptcha configuré (clé site + secret) : fournisseur effectif hCaptcha, clé publique exposée', async () => {
    await setCaptcha({ provider: 'hcaptcha', sitekey: '10000000-ffff-ffff-ffff-000000000001', secret: '0x0000000000000000000000000000000000000000' });
    const res = await resolveCaptcha();
    expect(res).toMatchObject({ requested: 'hcaptcha', provider: 'hcaptcha', configured: true, fallback: false });
    const info = await captchaPublicInfo();
    expect(info.provider).toBe('hcaptcha');
    expect(info.sitekey).toBe('10000000-ffff-ffff-ffff-000000000001');
    expect(info.svg).toBeUndefined(); // pas de défi interne quand un widget externe est actif
    expect(JSON.stringify(info)).not.toContain('0x0000000000000000'); // jamais de secret dans la charge publique
  });

  it('CAS DU DÉFAUT : hCaptcha choisi SANS clés → repli sur l’interne, la connexion reste possible', async () => {
    await setCaptcha({ provider: 'hcaptcha' });
    const res = await resolveCaptcha();
    // le vœu de l'administrateur est conservé (`requested`) mais la vérification est celle de l'interne
    expect(res).toMatchObject({ requested: 'hcaptcha', provider: 'internal', configured: false, fallback: true });
    const info = await captchaPublicInfo();
    expect(info.provider).toBe('internal');
    expect(info.fallback).toBe(true);
    expect(info.requested).toBe('hcaptcha');
    // l'écran reçoit un vrai défi (id + svg + question) : quelque chose s'affiche, et c'est vérifiable
    expect(info.id).toBeTruthy();
    expect(info.svg).toContain('<svg');
  });

  it('clé manquante côté secret uniquement : repli également (jamais de vérification impossible)', async () => {
    await setCaptcha({ provider: 'turnstile', sitekey: '1x00000000000000000000AA' });
    expect(await resolveCaptcha()).toMatchObject({ provider: 'internal', fallback: true });
  });

  it('les variables d’environnement complètent une configuration sans clés (déploiement out-of-the-box)', async () => {
    process.env.HCAPTCHA_SITEKEY = '10000000-ffff-ffff-ffff-000000000001';
    process.env.HCAPTCHA_SECRET = '0x0000000000000000000000000000000000000000';
    await setCaptcha({ provider: 'hcaptcha' });
    expect(await resolveCaptcha()).toMatchObject({ provider: 'hcaptcha', fallback: false, configured: true });
  });

  it('captcha désactivé : aucun défi, aucune clé', async () => {
    await setCaptcha({ provider: 'none' });
    const info = await captchaPublicInfo();
    expect(info).toMatchObject({ provider: 'none', sitekey: null });
    expect(info.svg).toBeUndefined();
  });
});

describe('la vérification suit le fournisseur EFFECTIF (et non celui demandé)', () => {
  beforeEach(async () => {
    delete process.env.HCAPTCHA_SITEKEY;
    delete process.env.HCAPTCHA_SECRET;
    vi.restoreAllMocks();
  });

  it('repli interne : un défi interne résolu est accepté, aucun appel réseau', async () => {
    await setCaptcha({ provider: 'hcaptcha' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const info = await captchaPublicInfo();
    const answer = String(Number(info.question!.split('+')[0]) + Number(info.question!.split('+')[1]));
    await expect(verifyCaptcha({ captchaId: info.id!, captchaValue: answer }, '127.0.0.1')).resolves.toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled(); // le fournisseur externe n'est pas contacté sans clés
  });

  it('hCaptcha configuré : la vérification poste le jeton vers api.hcaptcha.com avec le secret résolu', async () => {
    await setCaptcha({ provider: 'hcaptcha', sitekey: '10000000-ffff-ffff-ffff-000000000001', secret: 'secret-hcaptcha' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    await expect(verifyCaptcha({ hcaptchaToken: 'P0_eyJ0eXAi' }, '10.0.0.8')).resolves.toBe(true);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe('https://api.hcaptcha.com/siteverify');
    const body = String((init as RequestInit).body);
    expect(body).toContain('secret=secret-hcaptcha');
    expect(body).toContain('response=P0_eyJ0eXAi');
    expect(body).toContain('remoteip=10.0.0.8');
  });

  it('jeton refusé ou panne du fournisseur : refus (sécurité), sans lever d’exception', async () => {
    await setCaptcha({ provider: 'hcaptcha', sitekey: '10000000-ffff-ffff-ffff-000000000001', secret: 'secret-hcaptcha' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: false }), { status: 200 }));
    await expect(verifyCaptcha({ hcaptchaToken: 'faux' }, '127.0.0.1')).resolves.toBe(false);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('réseau'));
    await expect(verifyCaptcha({ hcaptchaToken: 'faux' }, '127.0.0.1')).resolves.toBe(false);
  });
});

describe('côté navigateur : champ, script et charge utile', () => {
  it('chaque fournisseur envoie le champ attendu par le serveur (loginZ)', () => {
    expect(captchaTokenField('hcaptcha')).toBe('hcaptchaToken');
    expect(captchaTokenField('turnstile')).toBe('turnstileToken');
    expect(captchaTokenField('recaptcha')).toBe('recaptchaToken');
    expect(captchaTokenField('internal')).toBeNull();
    expect(captchaNeedsToken('hcaptcha')).toBe(true);
    expect(captchaNeedsToken('internal')).toBe(false);
  });

  it('le script du widget est explicite et suit la langue de l’interface', () => {
    expect(captchaScriptUrl('hcaptcha', 'ar')).toContain('js.hcaptcha.com');
    expect(captchaScriptUrl('hcaptcha', 'ar')).toContain('render=explicit');
    expect(captchaScriptUrl('hcaptcha', 'ar')).toContain('hl=ar');
    expect(captchaScriptUrl('turnstile', 'fr')).toContain('challenges.cloudflare.com');
    expect(captchaScriptUrl('recaptcha', 'es')).toContain('hl=es');
    expect(captchaScriptUrl('internal', 'fr')).toBeNull();
    expect(captchaGlobalName('hcaptcha')).toBe('hcaptcha');
    expect(captchaGlobalName('turnstile')).toBe('turnstile');
    expect(captchaGlobalName('recaptcha')).toBe('grecaptcha');
  });

  it('la charge utile de connexion correspond au fournisseur actif', () => {
    expect(captchaPayload({ provider: 'hcaptcha', sitekey: 'k' }, { token: 'tok' })).toEqual({ hcaptchaToken: 'tok' });
    expect(captchaPayload({ provider: 'internal', id: 'abc' }, { value: '42' })).toEqual({ captchaId: 'abc', captchaValue: '42' });
    // défi non résolu : rien n'est envoyé (le serveur refuse, l'écran explique) — on n'invente pas de champ
    expect(captchaPayload({ provider: 'hcaptcha', sitekey: 'k' }, { token: '' })).toEqual({});
    expect(captchaPayload({ provider: 'none' }, {})).toEqual({});
  });
});

describe('formulaire Paramètres : configuration incohérente refusée à la saisie', () => {
  it('fournisseur externe sans clés : erreurs sur sitekey et secret', () => {
    expect(issuesByPath('captcha', { provider: 'hcaptcha' })).toEqual({ sitekey: 'captchaSitekey', secret: 'captchaSecret' });
    expect(issuesByPath('captcha', { provider: 'hcaptcha', sitekey: 'cle' })).toEqual({ secret: 'captchaSecret' });
  });

  it('clé secrète déjà enregistrée (masquée « •••• ») : pas de faux positif', () => {
    expect(issuesByPath('captcha', { provider: 'hcaptcha', sitekey: 'cle', secret: '••••••' })).toEqual({});
  });

  it('configuration complète ou mode interne/désactivé : aucune erreur', () => {
    expect(issuesByPath('captcha', { provider: 'hcaptcha', sitekey: 'cle', secret: 'secret' })).toEqual({});
    expect(issuesByPath('captcha', { provider: 'internal' })).toEqual({});
    expect(issuesByPath('captcha', { provider: 'none' })).toEqual({});
  });

  it('les codes de validation sont traduits dans les quatre langues', () => {
    for (const lang of ['fr', 'ar', 'es', 'en']) {
      const dict = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'locales', lang, 'settings.json'), 'utf8')) as Record<string, string>;
      expect(dict['settings.validation.captchaSitekey'], lang).toBeTruthy();
      expect(dict['settings.validation.captchaSecret'], lang).toBeTruthy();
      const auth = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'locales', lang, 'auth.json'), 'utf8')) as Record<string, string>;
      expect(auth['captcha.externalHint'], lang).toBeTruthy();
      expect(auth['captcha.externalBlocked'], lang).toBeTruthy();
      expect(auth['captcha.fallbackNotice'], lang).toContain('{provider}');
    }
  });
});

describe('le serveur reste tolérant à la LECTURE d’une section héritée incomplète', () => {
  it('une section captcha invalide en base fait retomber la lecture sur les défauts, sans casser', async () => {
    const db = await getDb();
    await db.removeWhere('settings', { key: 'captcha' });
    cacheDel('settings', 'settings:captcha');
    await db.insert('settings', { key: 'captcha', value_json: { provider: 'fournisseur-inexistant' } });
    const section = (await getSection('captcha', { fresh: true })) as { provider?: string };
    expect(section.provider).toBe('internal'); // repli documenté : la section illisible ne bloque jamais la connexion
    expect(await resolveProviderSafe()).toBe('internal');
  });
});

/** Petit utilitaire : fournisseur effectif après le scénario « section corrompue ». */
async function resolveProviderSafe(): Promise<string> {
  return (await resolveCaptcha()).provider;
}
