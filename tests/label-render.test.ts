/**
 * TEST DE NON-RÉGRESSION — libellés multilingues rendus comme enfants React.
 * ------------------------------------------------------------------
 * Erreur observée en production (page « Nouvelle ordonnance » et fiches de consultation) :
 *   « Objects are not valid as a React child (found: object with keys {fr, ar, es, en}) »
 * puis écran blanc : toute la page tombait, pas seulement la liste déroulante.
 *
 * Cause : la configuration des types d'intervention est saisie en base (JSONB non typé). Une
 * option de liste peut donc porter un libellé multilingue {fr,ar,es,en} au lieu d'une chaîne.
 * normOptions() le transmettait tel quel à <Select>, qui le rendait comme enfant React.
 * Le typage `label: string` masquait le problème à la compilation : les données viennent de la
 * base, pas du système de types.
 *
 * Verrous posés : résolution dans la langue active (normOptions) + garde-fou de dernier recours
 * dans le composant lui-même (optionLabel), pour qu'aucun autre appelant ne puisse replanter l'app.
 */
import { describe, expect, it } from 'vitest';
import { optionLabel } from '@/components/ui';
import { normOptions } from '@/components/record-fields';

/** Libellé multilingue tel qu'il est stocké en base (JSONB) pour une option de liste. */
const ML = { fr: 'Douleur thoracique', ar: 'ألم صدري', es: 'Dolor torácico', en: 'Chest pain' };

describe('optionLabel — garde-fou du composant Select', () => {
  it('une chaîne passe telle quelle', () => {
    expect(optionLabel('Cabinet')).toBe('Cabinet');
    expect(optionLabel('')).toBe('');
  });

  it("un objet multilingue ne sort JAMAIS en objet (le plantage d'origine)", () => {
    const out = optionLabel(ML);
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
    // Une des langues du libellé est retenue — pas « [object Object] », pas du JSON brut.
    expect(Object.values(ML)).toContain(out);
  });

  it('valeurs dégénérées : null, undefined, nombre, objet vide, objet sans chaîne', () => {
    expect(optionLabel(null)).toBe('');
    expect(optionLabel(undefined)).toBe('');
    expect(optionLabel(42)).toBe('42');
    expect(optionLabel({})).toBe('');
    expect(optionLabel({ fr: null, ar: 12 })).toBe('');
    // Une chaîne vide n'est pas retenue : on cherche une langue réellement renseignée.
    expect(optionLabel({ fr: '   ', es: 'Servicio' })).toBe('Servicio');
  });
});

describe('normOptions — options de liste d’une fiche de consultation', () => {
  it('résout un libellé multilingue dans la langue demandée', () => {
    const opts = normOptions([{ value: 'chest', label: ML }], 'fr');
    expect(opts).toEqual([{ value: 'chest', label: 'Douleur thoracique' }]);
    expect(normOptions([{ value: 'chest', label: ML }], 'ar')[0]?.label).toBe('ألم صدري');
    expect(normOptions([{ value: 'chest', label: ML }], 'es')[0]?.label).toBe('Dolor torácico');
    expect(normOptions([{ value: 'chest', label: ML }], 'en')[0]?.label).toBe('Chest pain');
  });

  it('toute option produite a une valeur ET un libellé de type chaîne', () => {
    const raw = [
      'simple',
      { value: 'a', label: 'Chaîne' },
      { value: 'b', label: ML },
      { value: 'c' }, // libellé absent → retombe sur la valeur
      { value: 'd', label: {} }, // objet vide → retombe sur la valeur
      { value: 'e', label: { fr: '', en: 'Fallback' } },
    ];
    // Le type déclaré est plus strict que les données réelles de la base : on force le cast pour
    // rejouer exactement le cas rencontré en production.
    const out = normOptions(raw as never, 'fr');
    expect(out).toHaveLength(raw.length);
    for (const o of out) {
      expect(typeof o.value).toBe('string');
      expect(typeof o.label).toBe('string');
      expect(o.label).not.toBe('');
      expect(o.label).not.toContain('[object Object]');
    }
    expect(out.map((o) => o.label)).toEqual(['simple', 'Chaîne', 'Douleur thoracique', 'c', 'd', 'Fallback']);
  });

  it('entrée invalide (ni tableau ni undefined) → liste vide, pas d’exception', () => {
    expect(normOptions(undefined, 'fr')).toEqual([]);
    expect(normOptions(null as never, 'fr')).toEqual([]);
    expect(normOptions({ value: 'x' } as never, 'fr')).toEqual([]);
  });

  it("langue absente du libellé : pickLabel retombe sur une langue disponible, jamais sur l'objet", () => {
    const out = normOptions([{ value: 'k', label: { fr: 'Français seulement' } }], 'ar');
    expect(typeof out[0]?.label).toBe('string');
    expect(out[0]?.label).not.toBe('');
  });
});
