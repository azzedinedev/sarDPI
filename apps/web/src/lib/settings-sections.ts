/**
 * CATALOGUE DES SECTIONS DE PARAMÈTRES — source unique pour le sous-menu (icône + regroupement) et
 * pour l'éditeur (présence d'un formulaire typé).
 * Séparé de la page pour être testable et vérifiable : la navigation, le filtre et le mode
 * d'édition (formulaire ou JSON validé) découlent tous de ces quelques lignes.
 */
import { Archive, CalendarClock, FileStack, Hash, HeartPulse, KeyRound, Languages, Mail, Palette, ShieldCheck, SlidersHorizontal, Stethoscope, Syringe, Workflow } from 'lucide-react';

type Icon = React.ComponentType<{ size?: number; className?: string }>;
export type SectionGroup = 'platform' | 'clinical' | 'communication' | 'security' | 'maintenance';

/** Ordre d'affichage des regroupements dans le sous-menu. */
export const SECTION_GROUPS: SectionGroup[] = ['platform', 'clinical', 'communication', 'security', 'maintenance'];

/**
 * Sections : `key` = segment d'API `/admin/settings/:key` ET suffixe des clés de traduction
 * `settings.sections.<key>`.
 *
 * `form` signale l'existence d'un formulaire typé. Depuis l'ajout des formulaires pilotés par
 * spécification (`lib/settings-fields.ts` : champs par module + validation + CRUD des listes),
 * TOUTES les sections en ont un — y compris celles qui n'étaient éditables qu'en JSON (types de
 * GED, types de praticiens, étapes du circuit, étiquettes du calendrier, vaccination, sécurité,
 * captcha, sauvegardes, licence). Le JSON reste disponible comme mode avancé, avec la même
 * validation ; le drapeau est conservé pour que la page et les tests parlent le même langage.
 */
export const SETTINGS_SECTIONS = [
  { key: 'general', icon: SlidersHorizontal, group: 'platform', form: true },
  { key: 'ui', icon: Palette, group: 'platform', form: true },
  { key: 'languages', icon: Languages, group: 'platform', form: true },
  { key: 'codification', icon: Hash, group: 'clinical', form: true },
  { key: 'medicalRefs', icon: HeartPulse, group: 'clinical', form: true },
  { key: 'gedTypes', icon: FileStack, group: 'clinical', form: true },
  { key: 'practitionerTypes', icon: Stethoscope, group: 'clinical', form: true },
  { key: 'workflowSteps', icon: Workflow, group: 'clinical', form: true },
  { key: 'calendarKinds', icon: CalendarClock, group: 'clinical', form: true },
  { key: 'vaccination', icon: Syringe, group: 'clinical', form: true },
  { key: 'smtp', icon: Mail, group: 'communication', form: true },
  { key: 'security', icon: ShieldCheck, group: 'security', form: true },
  { key: 'captcha', icon: KeyRound, group: 'security', form: true },
  { key: 'backups', icon: Archive, group: 'maintenance', form: true },
  { key: 'license', icon: KeyRound, group: 'maintenance', form: true },
] as const satisfies readonly { key: string; icon: Icon; group: SectionGroup; form: boolean }[];

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['key'];

/** Sections disposant d'un formulaire typé (désormais : toutes — le JSON est un mode avancé). */
export const FORM_SECTIONS: ReadonlySet<string> = new Set(SETTINGS_SECTIONS.filter((s) => s.form).map((s) => s.key));

/** Filtre partagé entre la colonne latérale (desktop) et le bandeau de pastilles (mobile). */
export function filterSections<T extends { key: string; label: string; group: SectionGroup }>(items: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((x) => x.label.toLowerCase().includes(q) || x.key.toLowerCase().includes(q));
}

/** Regroupe les sections présentes en conservant l'ordre de `SECTION_GROUPS` (les vides disparaissent). */
export function groupSections<T extends { group: SectionGroup }>(items: T[]): { group: SectionGroup; items: T[] }[] {
  return SECTION_GROUPS.map((group) => ({ group, items: items.filter((x) => x.group === group) })).filter((x) => x.items.length > 0);
}

/** Section suivante/précédente pour la navigation clavier du `tablist` (flèches, Début/Fin). */
export function nextSection(keys: string[], current: string, key: 'ArrowDown' | 'ArrowRight' | 'ArrowUp' | 'ArrowLeft' | 'Home' | 'End'): string | undefined {
  if (!keys.length) return undefined;
  const i = keys.indexOf(current);
  if (key === 'Home') return keys[0];
  if (key === 'End') return keys[keys.length - 1];
  if (i < 0) return keys[0];
  if (key === 'ArrowDown' || key === 'ArrowRight') return keys[(i + 1) % keys.length];
  return keys[(i - 1 + keys.length) % keys.length];
}

/**
 * État « modifications non enregistrées » — comparaison SÉRIALISÉE à la dernière version connue du
 * serveur (référence mise à jour après chaque enregistrement réussi).
 *  - mode formulaire : l'objet de travail diffère de la référence ;
 *  - mode JSON : le texte est comparé après normalisation ; un JSON encore INVALIDE compte comme
 *    modifié (sinon le bouton Enregistrer resterait grisé alors qu'il reste du travail à finir).
 */
export function sectionDirty(mode: 'form' | 'json', data: Record<string, unknown>, json: string, baseline: string): boolean {
  if (!baseline) return false;
  if (mode === 'form') return JSON.stringify(data) !== baseline;
  try {
    return JSON.stringify(JSON.parse(json)) !== baseline;
  } catch {
    return true;
  }
}
