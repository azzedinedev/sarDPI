/**
 * FORMULAIRES PAR CHAMP DES MODULES DE PARAMÈTRES — spécifications, validation, CRUD.
 * ------------------------------------------------------------------------------------------------
 * Ces sections n'étaient éditables qu'en JSON brut (`form: false`) : aucune validation à l'écran,
 * aucune liste éditable, un simple bloc de texte — donc des erreurs 422 au moment de l'enregistrement
 * et des doublons de clés invisibles. Elles disposent maintenant :
 *   - d'un formulaire par champ (libellés traduits, bornes, listes déroulantes, interrupteurs) ;
 *   - de messages d'erreur PAR CHAMP issus du MÊME schéma Zod que l'API ;
 *   - du CRUD complet sur les listes (ajouter, modifier, réordonner, supprimer) avec refus de doublon.
 *
 * Ce que ce fichier verrouille : la COUVERTURE (aucun module oublié, aucun libellé manquant dans les
 * quatre langues), la VALIDATION (les mêmes bornes que le serveur) et les OPÉRATIONS CRUD (pures).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  SECTION_FORMS,
  SPEC_SECTIONS,
  collectionAdd,
  collectionMove,
  collectionRemove,
  collectionUpdate,
  duplicateKeyIndex,
  fieldParse,
  fieldValue,
  getPath,
  issuesByPath,
  renumber,
  sectionSchema,
  setPath,
  validateJsonText,
  type CollectionSpec,
} from '../apps/web/src/lib/settings-fields';
import { SETTINGS_SECTIONS } from '../apps/web/src/lib/settings-sections';
import { isBlankRow } from '../apps/web/src/components/settings-form';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const LANGS = ['fr', 'ar', 'es', 'en'] as const;
const dicts = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(fs.readFileSync(path.join(ROOT, `locales/${l}/settings.json`), 'utf8')) as Record<string, string>]));

/** Toutes les clés i18n référencées par les spécifications (libellés, aides, options). */
function referencedKeys(): string[] {
  const keys: string[] = [];
  for (const spec of Object.values(SECTION_FORMS)) {
    for (const g of spec.groups) {
      if (g.titleKey) keys.push(g.titleKey);
      if (g.hintKey) keys.push(g.hintKey);
      for (const f of g.fields) {
        keys.push(f.labelKey);
        if (f.hintKey) keys.push(f.hintKey);
        for (const o of f.options ?? []) keys.push(o.labelKey);
      }
    }
    for (const c of spec.collections) {
      keys.push(c.labelKey);
      if (c.hintKey) keys.push(c.hintKey);
      for (const f of c.itemFields) {
        keys.push(f.labelKey);
        if (f.hintKey) keys.push(f.hintKey);
        for (const o of f.options ?? []) keys.push(o.labelKey);
      }
    }
  }
  return [...new Set(keys)];
}

describe('couverture des modules', () => {
  it('chaque section sans schéma JSON brut dispose d’un formulaire (plus aucune section « JSON seul »)', () => {
    const withForm = new Set(SETTINGS_SECTIONS.filter((s) => s.form).map((s) => s.key as string));
    for (const key of SPEC_SECTIONS) {
      expect(withForm.has(key), `section ${key} absente du catalogue`).toBe(true);
      expect(SECTION_FORMS[key], `spécification manquante pour ${key}`).toBeTruthy();
    }
    // les neuf modules autrefois en JSON brut sont tous couverts
    for (const key of ['gedTypes', 'practitionerTypes', 'workflowSteps', 'calendarKinds', 'vaccination', 'security', 'captcha', 'backups', 'license']) {
      expect(SPEC_SECTIONS).toContain(key);
    }
    // le catalogue et le moteur ne peuvent pas diverger
    expect(SETTINGS_SECTIONS.every((s) => s.form)).toBe(true);
  });

  it('chaque champ a un schéma de validation (sinon la saisie ne serait pas contrôlée)', () => {
    for (const key of SPEC_SECTIONS) expect(sectionSchema(key), key).toBeTruthy();
  });

  it('chaque liste éditable déclare un champ clé, un gabarit et des champs d’entrée', () => {
    for (const [key, spec] of Object.entries(SECTION_FORMS)) {
      for (const c of spec.collections) {
        expect(c.keyField, `${key}.${c.path}`).toBeTruthy();
        expect(c.itemFields.some((f) => f.path === c.keyField), `${key}.${c.path} : clé non éditable`).toBe(true);
        const template = c.template();
        expect(Object.keys(template).length).toBeGreaterThan(1);
        // le gabarit doit être VALIDE (une ligne ajoutée ne doit pas être rejetée d'emblée) sauf clé vide
        expect(c.itemFields.every((f) => f.path === c.keyField || getPath(template, f.path) !== undefined), `${key}.${c.path} : gabarit incomplet`).toBe(true);
      }
    }
  });

  it('tous les libellés référencés existent dans les quatre langues', () => {
    const missing: string[] = [];
    for (const k of referencedKeys()) {
      for (const l of LANGS) if (!dicts[l]![k]) missing.push(`${l}:${k}`);
    }
    expect(missing).toEqual([]);
  });

  it('les bornes annoncées dans les messages de validation existent dans les quatre langues', () => {
    for (const code of ['tooSmall', 'tooBig', 'required', 'enum', 'pattern', 'invalid', 'jsonSyntax', 'duplicateKey', 'gedPrefix', 'gedPath', 'stepKey', 'kindKey', 'vaccineKey', 'time']) {
      for (const l of LANGS) expect(dicts[l]![`settings.validation.${code}`], `${l}:${code}`).toBeTruthy();
    }
  });
});

describe('validation par champ (mêmes règles que l’API)', () => {
  it('security : bornes numériques, paliers de verrouillage, TOTP', () => {
    expect(issuesByPath('security', { signedUrlTtlMin: 3600, passwordMinLength: 8, lockout: { maxAttempts: 5, stepsMinutes: [1, 5] } })).toHaveProperty('signedUrlTtlMin', 'tooBig');
    expect(issuesByPath('security', { signedUrlTtlMin: 15, passwordMinLength: 4 })).toHaveProperty('passwordMinLength', 'tooSmall');
    expect(issuesByPath('security', { signedUrlTtlMin: 15, passwordMinLength: 10, lockout: { maxAttempts: 9, stepsMinutes: [2, 10] } })).toEqual({});
  });

  it('calendarKinds : clé technique, durée, couleur', () => {
    const bad = issuesByPath('calendarKinds', { kinds: [{ key: 'Radio', order: 1, color: '#fff', durationMin: 4, active: true, label: {} }], statuses: [] });
    expect(bad['kinds.0.key']).toBe('kindKey'); // majuscules interdites (clé stockée dans appointments.kind)
    const bad2 = issuesByPath('calendarKinds', { kinds: [{ key: 'radio', order: 1, color: '#fff', durationMin: 600, active: true, label: {} }], statuses: [] });
    expect(bad2['kinds.0.durationMin']).toBe('tooBig');
    expect(issuesByPath('calendarKinds', { kinds: [{ key: 'radio', order: 1, color: '#0ea5b7', durationMin: 30, active: true, label: { fr: 'Radio' } }], statuses: [] })).toEqual({});
  });

  it('gedTypes / practitionerTypes / workflowSteps / vaccination : motifs et bornes', () => {
    expect(issuesByPath('gedTypes', { types: [{ prefix: 'a', path: 'Analyses 2026', label: {} }] })['types.0.prefix']).toBe('gedPrefix');
    expect(issuesByPath('gedTypes', { types: [{ prefix: 'ANL', path: 'Analyses 2026', label: {} }] })['types.0.path']).toBe('gedPath');
    expect(issuesByPath('practitionerTypes', { types: [{ prefix: 'MED', label: {} }] })).toEqual({});
    expect(issuesByPath('workflowSteps', { allowSkip: true, steps: [{ key: 'Admission', order: 1, color: '#000', label: {} }] })['steps.0.key']).toBe('stepKey');
    expect(issuesByPath('vaccination', { enabled: true, schedule: [{ key: 'bcg', doses: 12 }] })['schedule.0.doses']).toBe('tooBig');
  });

  it('backups / captcha / license : formats et énumérations', () => {
    expect(issuesByPath('backups', { retentionDays: 30, auto: true, cronTime: '25:00' })).toHaveProperty('cronTime', 'time');
    expect(issuesByPath('backups', { retentionDays: 30, auto: true, cronTime: '03:30' })).toEqual({});
    expect(issuesByPath('captcha', { provider: 'askimet' })).toHaveProperty('provider', 'enum');
    expect(issuesByPath('license', { state: 'valid', maxUsers: 100 })).toEqual({});
  });

  it('l’écriture par chemin reste immuable (les données de section ne sont jamais mutées)', () => {
    const src = { lockout: { maxAttempts: 5, stepsMinutes: [1] }, passwordMinLength: 10 };
    const next = setPath(src, 'lockout.maxAttempts', 7);
    expect(src.lockout.maxAttempts).toBe(5);
    expect(next.lockout.maxAttempts).toBe(7);
    expect(getPath(next, 'lockout.stepsMinutes')).toEqual([1]);
  });

  it('le mode JSON avancé applique exactement la même validation', () => {
    expect(validateJsonText('backups', '{ "retentionDays": 30, "auto": false, "cronTime": "03:30" }').ok).toBe(true);
    const bad = validateJsonText('backups', '{ "retentionDays": 0, "auto": false, "cronTime": "03:30" }');
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.retentionDays).toBe('tooSmall');
      expect(bad.vars.retentionDays).toMatchObject({ min: 1 });
    }
    const broken = validateJsonText('backups', '{ "retentionDays": }');
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.errors._).toBe('jsonSyntax');
  });
});

describe('CRUD des listes', () => {
  const spec: CollectionSpec = SECTION_FORMS.calendarKinds!.collections.find((c) => c.path === 'kinds')!;

  it('ajout : ligne vierge ajoutée et ordre renuméroté', () => {
    const rows = [{ key: 'a', order: 1 }, { key: 'b', order: 2 }];
    const next = collectionAdd(rows, spec);
    expect(next).toHaveLength(3);
    expect(next.map((r) => r.order)).toEqual([1, 2, 3]);
    expect(rows).toHaveLength(2); // la liste d'origine n'est pas modifiée
  });

  it('déplacement : l’ordre suit la position (le formulaire ne saisit jamais « order »)', () => {
    const rows = [{ key: 'a', order: 1 }, { key: 'b', order: 2 }, { key: 'c', order: 3 }];
    expect(collectionMove(rows, 0, 1, spec).map((r) => r.key)).toEqual(['b', 'a', 'c']);
    expect(collectionMove(rows, 2, -1, spec).map((r) => r.key)).toEqual(['a', 'c', 'b']);
    expect(collectionMove(rows, 0, -1, spec).map((r) => r.key)).toEqual(['a', 'b', 'c']); // bord : aucun effet
    expect(collectionMove(rows, 2, 1, spec).map((r) => r.key)).toEqual(['a', 'b', 'c']);
    expect(collectionMove(rows, 0, 1, spec).map((r) => r.order)).toEqual([1, 2, 3]);
  });

  it('modification et suppression', () => {
    const rows = [{ key: 'a', order: 1, color: '#111' }, { key: 'b', order: 2, color: '#222' }];
    expect(collectionUpdate(rows, 1, { color: '#0ea5b7' }, spec)[1]).toMatchObject({ key: 'b', color: '#0ea5b7' });
    const after = collectionRemove(rows, 0, spec);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ key: 'b', order: 1 });
  });

  it('doublon de clé : détecté (et ligne éditée exclue du contrôle)', () => {
    const rows = [{ key: 'radio' }, { key: 'lab' }];
    expect(duplicateKeyIndex(rows, 'key', 'lab')).toBe(1);
    expect(duplicateKeyIndex(rows, 'key', 'lab', 1)).toBe(-1); // sa propre ligne ne se bloque pas
    expect(duplicateKeyIndex(rows, 'key', '  ')).toBe(-1); // clé vide : c'est « requis », pas « dupliqué »
    expect(duplicateKeyIndex(rows, 'key', 'IRM')).toBe(-1);
  });

  it('renumérotation utilitaire', () => {
    expect(renumber([{ key: 'a' }, { key: 'b' }], 'order').map((r) => r.order)).toEqual([1, 2]);
    expect(renumber([{ key: 'a' }], undefined)).toEqual([{ key: 'a' }]);
  });
});

describe('conversion des saisies', () => {
  const numberField = { path: 'retentionDays', kind: 'number' as const, labelKey: 'x' };
  const switchField = { path: 'auto', kind: 'switch' as const, labelKey: 'x' };
  const numbersField = { path: 'lockout.stepsMinutes', kind: 'numbers' as const, labelKey: 'x' };
  const labelField = { path: 'label', kind: 'i18n' as const, labelKey: 'x' };

  it('nombres : conversion, refus du non numérique, champ vidé = clé absente (message « requis »)', () => {
    expect(fieldParse(numberField, '42')).toBe(42);
    expect(fieldParse(numberField, '')).toBeUndefined();
    expect(fieldParse(numberField, 'abc')).toBeUndefined();
    expect(fieldParse(switchField, true)).toBe(true);
  });

  it('listes de nombres : virgules, espaces et points-virgules acceptés', () => {
    expect(fieldParse(numbersField, '1, 5, 15')).toEqual([1, 5, 15]);
    expect(fieldParse(numbersField, '1;5; 60')).toEqual([1, 5, 60]);
    expect(fieldParse(numbersField, '')).toEqual([]);
  });

  it('valeur affichée : jamais « undefined » à l’écran, libellés multilingues préservés', () => {
    expect(fieldValue({}, numberField)).toBe('');
    expect(fieldValue({ auto: 0 }, switchField)).toBe(false);
    expect(fieldValue({ auto: 1 }, switchField)).toBe(true);
    expect(fieldValue({ lockout: { stepsMinutes: [1, 5] } }, numbersField)).toBe('1, 5');
    expect(fieldValue({ label: { fr: 'Analyse' } }, labelField)).toEqual({ fr: 'Analyse' });
  });

  it('ligne vierge : un ajout abandonné est retiré, un début de saisie est conservé', () => {
    const ged = SECTION_FORMS.gedTypes!.collections[0]!;
    const blank = ged.template();
    expect(isBlankRow(blank, ged)).toBe(true);
    expect(isBlankRow({ ...blank, label: { fr: 'Biologie' } }, ged)).toBe(false);
    expect(isBlankRow({ ...blank, prefix: 'BIO' }, ged)).toBe(false);
    const kind = SECTION_FORMS.calendarKinds!.collections[0]!;
    expect(isBlankRow(kind.template(), kind)).toBe(true);
    // un interrupteur passé à « actif » seul n'est pas un contenu (le gabarit le met déjà)
    expect(isBlankRow({ ...kind.template(), active: true }, kind)).toBe(true);
  });
});
