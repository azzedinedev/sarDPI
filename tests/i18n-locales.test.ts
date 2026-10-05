/**
 * TEST DE NON-RÉGRESSION — cohérence des fichiers de traduction.
 * -----------------------------------------------------------------
 * Bug corrigé : la clé `settings/admin.system` (carte « Supervision système » du hub /admin) était
 * utilisée par le code mais absente des 4 dictionnaires → l'identifiant brut s'affichait, et la
 * console se remplissait de « [i18n] clé manquante : fr/settings/admin.system » (idem ar/es/en).
 * Cause plus générale : les clés peuvent être construites dynamiquement (`records.perms.${module}`,
 * `t(x.key)`) et échapper à un balayage de littéraux.
 *
 * Ces tests verrouillent :
 *   1. la parité stricte des jeux de clés entre fr/ar/es/en (aucune langue en retard) ;
 *   2. la non-régression « clé utilisée mais absente » via scripts/scan-i18n-keys.mjs (code retour 1).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'languages.json'), 'utf8')) as { languages: { code: string }[]; namespaces: string[] };
const LANGS = manifest.languages.map((l) => l.code);

describe('dictionnaires /locales — cohérence', () => {
  it('chaque langue expose tous les namespaces du manifeste, sans valeur vide', () => {
    for (const lang of LANGS) {
      for (const ns of manifest.namespaces) {
        const file = path.join(ROOT, 'locales', lang, `${ns}.json`);
        expect(fs.existsSync(file), `${lang}/${ns}.json manquant`).toBe(true);
        const dict = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;
        for (const [k, v] of Object.entries(dict)) {
          expect(typeof v, `${lang}/${ns} → ${k} : valeur non textuelle`).toBe('string');
          expect(v.length, `${lang}/${ns} → ${k} : valeur vide`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('les 4 langues ont exactement le même jeu de clés par namespace (aucune langue en retard)', () => {
    const [ref, ...others] = LANGS;
    for (const ns of manifest.namespaces) {
      const refKeys = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', ref!, `${ns}.json`), 'utf8')) as object).sort();
      for (const lang of others) {
        const keys = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', lang, `${ns}.json`), 'utf8')) as object).sort();
        const missing = refKeys.filter((k) => !keys.includes(k));
        const extra = keys.filter((k) => !refKeys.includes(k));
        expect({ lang, ns, missing, extra }).toEqual({ lang, ns, missing: [], extra: [] });
      }
    }
  });

  it('aucune clé utilisée par le code n’est absente des dictionnaires (balayage statique)', () => {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'scan-i18n-keys.mjs')], { cwd: ROOT, encoding: 'utf8' });
    expect(out).toContain('Aucune clé littérale manquante');
    expect(out).toContain('tous traduits'); // codes ApiError (errors.validation, errors.licenseRequired…)
  });

  it('le repli « erreurs » ramène les deux formes de clé à la clé canonique', async () => {
    const { canonicalErrorKey } = await import('../apps/web/src/lib/i18n');
    expect(canonicalErrorKey('errors.errors.validation')).toBe('errors.validation');
    expect(canonicalErrorKey('errors.licenseRequired')).toBe('errors.licenseRequired');
    expect(canonicalErrorKey('errors.locked')).toBe('errors.locked');
    expect(canonicalErrorKey('errors')).toBeNull();
    expect(canonicalErrorKey('patients.list.title')).toBeNull();
  });
});
