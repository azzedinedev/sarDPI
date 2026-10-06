/**
 * TEST DE NON-RÉGRESSION — sous-menu des Paramètres (navigation, filtre, regroupements).
 * ---------------------------------------------------------------------------------------
 * La page Paramètres empilait 15 sections dans des onglets horizontaux qui débordaient, dans une
 * colonne bridée à `max-w-4xl` (grandes marges vides sur poste large). La refonte introduit une
 * colonne collante groupée (desktop) + un bandeau de pastilles (mobile) : ces tests verrouillent
 * la logique partagée par les deux — une seule source de vérité, donc pas de divergence possible.
 */
import { describe, expect, it } from 'vitest';
import { FORM_SECTIONS, SETTINGS_SECTIONS, filterSections, groupSections, nextSection } from '../apps/web/src/lib/settings-sections';

const items = SETTINGS_SECTIONS.map((s) => ({ key: s.key as string, label: s.key, group: s.group }));

describe('catalogue des sections de paramètres', () => {
  it('chaque section a une clé unique, une icône et un regroupement connu', () => {
    const keys = SETTINGS_SECTIONS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of SETTINGS_SECTIONS) {
      expect(typeof s.icon).toBe('object');
      expect(['platform', 'clinical', 'communication', 'security', 'maintenance']).toContain(s.group);
    }
    expect(SETTINGS_SECTIONS.length).toBe(15);
  });

  it('le regroupement conserve l’ordre déclaré et supprime les groupes vides', () => {
    const grouped = groupSections(items);
    expect(grouped.map((g) => g.group)).toEqual(['platform', 'clinical', 'communication', 'security', 'maintenance']);
    expect(grouped.every((g) => g.items.length > 0)).toBe(true);
    // la somme des sections regroupées = le catalogue entier (aucune section perdue en route)
    expect(grouped.reduce((n, g) => n + g.items.length, 0)).toBe(SETTINGS_SECTIONS.length);
  });

  it('le filtre cherche le libellé traduit OU la clé technique (espaces ignorés)', () => {
    const labelled = SETTINGS_SECTIONS.map((s) => ({ key: s.key as string, label: s.key === 'smtp' ? 'E-mail (SMTP)' : s.key, group: s.group }));
    expect(filterSections(labelled, '').length).toBe(15);
    expect(filterSections(labelled, 'smtp').map((x) => x.key)).toEqual(['smtp']);
    expect(filterSections(labelled, 'e-mail').map((x) => x.key)).toEqual(['smtp']);
    expect(filterSections(labelled, '  ').length).toBe(15);
    expect(filterSections(labelled, 'inexistant')).toEqual([]);
  });

  it('navigation clavier : flèches circulaires, Début/Fin', () => {
    const keys = items.map((x) => x.key);
    expect(nextSection(keys, 'general', 'ArrowDown')).toBe('ui');
    expect(nextSection(keys, keys[keys.length - 1]!, 'ArrowDown')).toBe(keys[0]); // boucle
    expect(nextSection(keys, 'general', 'ArrowUp')).toBe(keys[keys.length - 1]);
    expect(nextSection(keys, 'smtp', 'End')).toBe(keys[keys.length - 1]);
    expect(nextSection(keys, 'smtp', 'Home')).toBe(keys[0]);
    expect(nextSection([], 'general', 'ArrowDown')).toBeUndefined();
  });

  it('les sections sans formulaire basculent en JSON validé (et l’inverse)', () => {
    expect(FORM_SECTIONS.has('general')).toBe(true);
    expect(FORM_SECTIONS.has('smtp')).toBe(true);
    expect(FORM_SECTIONS.has('security')).toBe(false);
    expect(FORM_SECTIONS.has('workflowSteps')).toBe(false);
    // toute section hors formulaire doit avoir un libellé « sections.<clé> » : vérifié par
    // tests/i18n-locales.test.ts (parité des dictionnaires) + balayage des clés dynamiques.
  });
});
