/**
 * Libellés multilingues : toute valeur configurable (statuts, types d'interventions, catégories…)
 * porte un objet { ar, fr, es, en } partiel — cf. cahier des charges §5.
 */
export type Lang = 'ar' | 'fr' | 'es' | 'en' | string;

export type MultiLabel = { fr?: string; ar?: string; es?: string; en?: string } & Record<string, string | undefined>;

export const LANGS = ['ar', 'fr', 'es', 'en'] as const;

/** Choisit le libellé dans la langue demandée, avec repli (fr par défaut). Jamais de clé brute. */
export function pickLabel(label: MultiLabel | string | undefined | null, lang: Lang, fallback: Lang = 'fr'): string {
  if (!label) return '';
  if (typeof label === 'string') return label;
  return label[lang] ?? label[fallback] ?? label.fr ?? label.ar ?? label.en ?? label.es ?? Object.values(label).find(Boolean) ?? '';
}

export function initialsOf(first?: string | null, last?: string | null): string {
  const a = (first ?? '').trim().charAt(0);
  const b = (last ?? '').trim().charAt(0);
  return (b + a).toUpperCase() || '•';
}

/** Âge en années révolues (fuseau du profil pays côté serveur). */
export function ageFromBirth(birthISO: string | null | undefined, now: Date = new Date()): number | null {
  if (!birthISO) return null;
  const b = new Date(birthISO);
  if (Number.isNaN(b.getTime())) return null;
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return Math.max(0, age);
}
