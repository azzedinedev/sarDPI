/**
 * SCHÉMAS DES SECTIONS DE PARAMÈTRES — partagés UI ↔ API.
 * -------------------------------------------------------------------------------------------
 * Ces schémas vivaient côté serveur uniquement (`server/settings/index.ts`). Ils sont remontés ici
 * pour être la SOURCE UNIQUE de validation : le formulaire d'administration valide la même chose que
 * l'API, avec les mêmes contraintes (bornes, motifs, énumérations), et affiche donc une erreur de
 * champ AVANT l'appel réseau — sans jamais desserrer la validation serveur, qui reste l'autorité.
 *
 * Les sections où chaque valeur est un simple scalaire (general, ui, codification, smtp, langues) vivent
 * dans `entities.ts` ; celles-ci portent des LISTES éditables (CRUD) ou des champs imbriqués.
 */
import { z } from 'zod';
import type { VaccineScheduleEntry } from './vaccination';
import { captchaProviders } from './entities';

/* ------------------------------------------------------------------------- types de documents (GED) */

export const gedTypesZ = z.object({
  types: z
    .array(
      z.object({
        prefix: z.string().regex(/^[A-Z]{2,5}$/, 'gedPrefix'),
        path: z.string().regex(/^[a-z0-9_-]{1,30}$/, 'gedPath'),
        label: z.record(z.string()),
      }),
    )
    .default([]),
});

/* ------------------------------------------------------------------------- types de praticiens */

export const practitionerTypesZ = z.object({
  types: z
    .array(
      z.object({
        prefix: z.string().regex(/^[A-Z]{2,5}$/, 'gedPrefix'),
        label: z.record(z.string()),
      }),
    )
    .default([]),
});

/* ------------------------------------------------------------------------- circuit de soins */

export const workflowStepZ = z.object({
  key: z.string().regex(/^[a-z_]{2,30}$/, 'stepKey'),
  order: z.number().int(),
  color: z.string().max(9).default('#0ea5b7'),
  label: z.record(z.string()),
});

export const workflowsZ = z.object({
  steps: z.array(workflowStepZ).default([]),
  allowSkip: z.boolean().default(true),
});

/* ------------------------------------------------------ étiquettes du calendrier (types & statuts) */

/**
 * Types de RDV (`kind`) et statuts configurables en base : libellés multilingues, couleur, durée.
 * Les `key` existants sont référencés par `appointments.kind` / `.status` : les renommer
 * orphelinerait des rendez-vous (l'interface verrouille donc la clé d'une ligne existante).
 */
export const calendarKindsZ = z.object({
  kinds: z
    .array(
      z.object({
        key: z.string().regex(/^[a-z_]{2,30}$/, 'kindKey'),
        order: z.number().int(),
        color: z.string().max(9).default('#3b82f6'),
        durationMin: z.number().int().min(5).max(480).default(30),
        active: z.boolean().default(true),
        label: z.record(z.string()),
      }),
    )
    .default([]),
  statuses: z
    .array(
      z.object({
        key: z.string().regex(/^[a-z_]{2,30}$/, 'kindKey'),
        order: z.number().int(),
        color: z.string().max(9).default('#64748b'),
        label: z.record(z.string()),
      }),
    )
    .default([]),
});

/* ------------------------------------------------------------------------- vaccination (carnet) */

/**
 * Une entrée de calendrier vaccinal. Le schéma précédent était `z.array(z.record(z.unknown()))` :
 * aucune contrainte, donc ni formulaire ni validation possibles. Les clés inconnues d'une entrée
 * historique sont PRÉSERVÉES (`passthrough`) pour ne rien perdre d'une configuration existante.
 *
 * `ageMonths` / `ageWeeks` sont les âges recommandés UTILISÉS PAR LE CALCUL d'échéance
 * (naissance + mois + semaines, puis + `intervalDays` par dose suivante) ; `ageLabel` reste le
 * texte affiché dans le carnet (« 6 semaines », « 9 mois »).
 */
export const vaccinationEntryZ = z
  .object({
    key: z.string().regex(/^[a-z0-9_]{2,30}$/, 'vaccineKey'),
    label: z.record(z.string()).default({}),
    ageLabel: z.string().max(40).default(''),
    ageMonths: z.number().int().min(0).max(300).default(0),
    ageWeeks: z.number().int().min(0).max(1560).default(0),
    doses: z.number().int().min(1).max(10).default(1),
    intervalDays: z.number().int().min(0).max(3650).default(0),
    mandatory: z.boolean().default(false),
    active: z.boolean().default(true),
  })
  .passthrough();

export const vaccinationSectionZ = z.object({
  enabled: z.boolean().default(true),
  schedule: z.array(vaccinationEntryZ).default([]),
});

/**
 * Calendrier vaccinal par défaut — calendrier national algérien (profil pays DZ,
 * `country-profiles/DZ.json` » vaccination.defaultSchedule) exprimé avec les âges structurés qui
 * servent au calcul des échéances. Matérialisé à l'installation (`npm run db:sync` / premier
 * démarrage) ; l'administrateur reste libre de le modifier ligne à ligne.
 */
export const DEFAULT_VACCINATION_SCHEDULE: VaccineScheduleEntry[] = [
  { key: 'bcg', label: { fr: 'BCG (tuberculose)', ar: 'BCG (السل)', es: 'BCG (tuberculosis)', en: 'BCG (tuberculosis)' }, ageLabel: 'Naissance', ageMonths: 0, ageWeeks: 0, doses: 1, intervalDays: 0, mandatory: true, active: true },
  { key: 'penta1', label: { fr: 'Pentavalent 1', ar: 'خماسي 1', es: 'Pentavalente 1', en: 'Pentavalent 1' }, ageLabel: '6 semaines', ageMonths: 0, ageWeeks: 6, doses: 1, intervalDays: 0, mandatory: true, active: true },
  { key: 'penta2', label: { fr: 'Pentavalent 2', ar: 'خماسي 2', es: 'Pentavalente 2', en: 'Pentavalent 2' }, ageLabel: '10 semaines', ageMonths: 0, ageWeeks: 10, doses: 1, intervalDays: 0, mandatory: true, active: true },
  { key: 'penta3', label: { fr: 'Pentavalent 3', ar: 'خماسي 3', es: 'Pentavalente 3', en: 'Pentavalent 3' }, ageLabel: '14 semaines', ageMonths: 0, ageWeeks: 14, doses: 1, intervalDays: 0, mandatory: true, active: true },
  { key: 'pcv13_1', label: { fr: 'Pneumocoque 1', ar: 'مكورة رئوية 1', es: 'Neumococo 1', en: 'Pneumococcus 1' }, ageLabel: '6 semaines', ageMonths: 0, ageWeeks: 6, doses: 1, intervalDays: 0, mandatory: false, active: true },
  { key: 'pcv13_2', label: { fr: 'Pneumocoque 2', ar: 'مكورة رئوية 2', es: 'Neumococo 2', en: 'Pneumococcus 2' }, ageLabel: '14 semaines', ageMonths: 0, ageWeeks: 14, doses: 1, intervalDays: 0, mandatory: false, active: true },
  { key: 'rota1', label: { fr: 'Rotavirus 1', ar: 'روتافيروس 1', es: 'Rotavirus 1', en: 'Rotavirus 1' }, ageLabel: '6 semaines', ageMonths: 0, ageWeeks: 6, doses: 1, intervalDays: 0, mandatory: false, active: true },
  { key: 'rota2', label: { fr: 'Rotavirus 2', ar: 'روتافيروس 2', es: 'Rotavirus 2', en: 'Rotavirus 2' }, ageLabel: '10 semaines', ageMonths: 0, ageWeeks: 10, doses: 1, intervalDays: 0, mandatory: false, active: true },
  { key: 'polio1', label: { fr: 'Poliomyélite (VPO/VPI) 1', ar: 'شلل الأطفال 1', es: 'Poliomielitis 1', en: 'Polio 1' }, ageLabel: '6 semaines', ageMonths: 0, ageWeeks: 6, doses: 1, intervalDays: 0, mandatory: true, active: true },
  { key: 'measles1', label: { fr: 'Rougeole 1', ar: 'حصبة 1', es: 'Sarampión 1', en: 'Measles 1' }, ageLabel: '9 mois', ageMonths: 9, ageWeeks: 0, doses: 1, intervalDays: 0, mandatory: true, active: true },
  { key: 'mmr1', label: { fr: 'ROR 1 (rougeole-oreillons-rubéole)', ar: 'ثلاثي 1', es: 'SRP 1', en: 'MMR 1' }, ageLabel: '18 mois', ageMonths: 18, ageWeeks: 0, doses: 1, intervalDays: 0, mandatory: true, active: true },
  { key: 'mmr2', label: { fr: 'ROR 2', ar: 'ثلاثي 2', es: 'SRP 2', en: 'MMR 2' }, ageLabel: '6 ans', ageMonths: 72, ageWeeks: 0, doses: 1, intervalDays: 0, mandatory: true, active: true },
  { key: 'dtcap', label: { fr: 'Rappel DTC-Polio (6 ans)', ar: 'جرعة منشطة DTC 6 سنوات', es: 'Refuerzo DTC-Polio (6 años)', en: 'DTC-Polio booster (6 yo)' }, ageLabel: '6 ans', ageMonths: 72, ageWeeks: 0, doses: 1, intervalDays: 0, mandatory: true, active: true },
];

/* ------------------------------------------------------------------------- captcha */

/**
 * `provider` SANS valeur par défaut : le serveur y applique la sienne (`CAPTCHA_PROVIDER`), qui doit
 * continuer de primer tant que l'administrateur n'a rien choisi (voir `resolveProvider`). Un défaut
 * ici figerait « internal » et rendrait la variable d'environnement inopérante.
 */
export const captchaModes = ['math', 'image'] as const;
export type CaptchaMode = (typeof captchaModes)[number];

export const captchaSectionZ = z.object({
  provider: z.enum(captchaProviders), // constante déjà exportée par entities.ts
  mode: z.enum(captchaModes).default('math'),
  sitekey: z.string().max(120).optional(),
  secret: z.string().max(200).optional(),
});

/* ------------------------------------------------------------------------- sauvegardes & licence */

export const backupZ = z.object({
  retentionDays: z.number().int().min(1).max(999).default(30),
  auto: z.boolean().default(false),
  cronTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time').default('03:30'),
});

export const licenseSectionZ = z.object({
  key: z.string().max(200).optional(),
  state: z.enum(['valid', 'trial', 'expired', 'invalid', 'none']).default('trial'),
  expiresAt: z.string().optional(),
  maxUsers: z.number().int().default(100),
  org: z.string().max(160).optional(),
});

export type GedTypesSection = z.infer<typeof gedTypesZ>;
export type WorkflowsSection = z.infer<typeof workflowsZ>;
export type CalendarKindsSection = z.infer<typeof calendarKindsZ>;
export type VaccinationSection = z.infer<typeof vaccinationSectionZ>;
export type BackupSection = z.infer<typeof backupZ>;
export type LicenseSection = z.infer<typeof licenseSectionZ>;
