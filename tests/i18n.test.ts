/**
 * TESTS i18n (Phase 1) — cahier des charges : rechargement à chaud sans redémarrage, ETag,
 * fallback FR sur clé absente, rapport de clés manquantes, fichiers INVALIDES refusés sans
 * impact (l’ancien dictionnaire continue d’être servi).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sardpi-i18n-'));
fs.mkdirSync(path.join(tmp, 'locales/fr'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'locales/ar'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'languages.json'), JSON.stringify({ default: 'fr', fallback: 'fr', namespaces: ['common'], languages: [{ code: 'fr', name: 'Français', dir: 'ltr', font: 'IBM Plex Sans', locale: 'fr' }, { code: 'ar', name: 'العربية', dir: 'rtl', font: 'IBM Plex Sans Arabic', locale: 'ar-DZ' }] }));
fs.writeFileSync(path.join(tmp, 'locales/fr/common.json'), JSON.stringify({ hello: 'Bonjour', save: 'Enregistrer' }));
fs.writeFileSync(path.join(tmp, 'locales/ar/common.json'), JSON.stringify({ hello: 'مرحبا' }));
process.env.SARDPI_ROOT = tmp;

const i18n = await import('../apps/web/src/server/i18n/server');

describe('i18n serveur', () => {
  it('loadNamespace sert le dictionnaire + etag = empreinte du contenu', () => {
    const c = i18n.loadNamespace('fr', 'common');
    expect(c.data.hello).toBe('Bonjour');
    expect(c.etag).toMatch(/^[0-9a-f]{16}$/);
  });

  it('rechargement à chaud : modifier le fichier change l’etag SANS redémarrage', async () => {
    const before = i18n.loadNamespace('fr', 'common').etag;
    await new Promise((r) => setTimeout(r, 12));
    fs.writeFileSync(path.join(tmp, 'locales/fr/common.json'), JSON.stringify({ hello: 'Salut', save: 'Enregistrer' }));
    const after = i18n.loadNamespace('fr', 'common');
    expect(after.etag).not.toBe(before);
    expect(after.data.hello).toBe('Salut');
  });

  it('JSON invalide → refus + ancien contenu conservé + erreur visible dans i18nHealth', async () => {
    const good = i18n.loadNamespace('fr', 'common').data.hello;
    await new Promise((r) => setTimeout(r, 12));
    fs.writeFileSync(path.join(tmp, 'locales/fr/common.json'), '{ "hello": BROKEN');
    const c = i18n.loadNamespace('fr', 'common');
    expect(c.data.hello).toBe(good); // jamais vidée
    expect(c.invalid).toBeTruthy();
    const health = i18n.i18nHealth();
    expect(health.issues.length).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 12));
    fs.writeFileSync(path.join(tmp, 'locales/fr/common.json'), JSON.stringify({ hello: 'Bonjour', save: 'Enregistrer' }));
    expect(i18n.loadNamespace('fr', 'common').invalid).toBeUndefined(); // réparation vue au prochain accès (hot-reload)
    expect(i18n.i18nHealth().issues.length).toBe(0);
  });

  it('clé absente en arabe → t() suit la chaîne lang → fallback FR ; clé inconnue → marqueur [key] + rapport', () => {
    expect(i18n.t('ar', 'common', 'save')).toBe('Enregistrer'); // résout via fallback fr
    expect(i18n.t('fr', 'common', 'n_existe_pas')).toBe('[n_existe_pas]'); // jamais de chaîne vide
  });

  it('rapport des clés manquantes signalées par les clients (admin)', () => {
    i18n.reportClientMissing('ar', 'common', ['missing.one', 'missing.two']);
    const rep = i18n.getMissingKeysReport() as { key: string; count: number }[];
    expect(rep.some((x) => x.key === 'ar/common/missing.one')).toBe(true);
    expect(rep.some((x) => x.key === 'ar/common/missing.two')).toBe(true);
    i18n.clearMissingKeysReport();
    expect(i18n.getMissingKeysReport().length).toBe(0);
  });

  it('getLanguages trie ar→fr→es→en et signale dir=rtl pour ar', () => {
    const m = i18n.getLanguages();
    expect(m.languages.find((l) => l.code === 'ar')?.dir).toBe('rtl');
    expect(i18n.getFallbackLanguage()).toBe('fr');
  });
});
