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
 */
export const vaccinationEntryZ = z
  .object({
    key: z.string().regex(/^[a-z0-9_]{2,30}$/, 'vaccineKey'),
    label: z.record(z.string()).default({}),
    ageLabel: z.string().max(40).default(''),
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

/* ------------------------------------------------------------------------- captcha */

/**
 * `provider` SANS valeur par défaut : le serveur y applique la sienne (`CAPTCHA_PROVIDER`), qui doit
 * continuer de primer tant que l'administrateur n'a rien choisi (voir `resolveProvider`). Un défaut
 * ici figerait « internal » et rendrait la variable d'environnement inopérante.
 */
export const captchaSectionZ = z.object({
  provider: z.enum(captchaProviders), // constante déjà exportée par entities.ts
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
