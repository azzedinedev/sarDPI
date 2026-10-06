/**
 * FORMULAIRES DE PARAMÈTRES PILOTÉS PAR SPÉCIFICATION — champs par module, validation, CRUD.
 * ------------------------------------------------------------------------------------------------
 * Pourquoi une spécification plutôt que du JSX par section ? Chaque module de paramètres a la même
 * anatomie : quelques champs scalaires + une ou deux LISTES éditables (types de GED, types de
 * praticiens, étapes de circuit, étiquettes du calendrier, calendrier vaccinal). Écrire ces écrans
 * à la main donne neuf formulaires divergents (validation approximative, pas de CRUD, pas d'erreurs
 * par champ). Ici :
 *
 *   - `SECTION_FORMS`     → quels champs par module, leur type, leurs bornes, leurs libellés ;
 *   - `sectionSchema()`   → le MÊME schéma Zod que l'API (paquet partagé) : la validation du
 *                           formulaire ne peut pas dériver de celle du serveur ;
 *   - `issuesByPath()`    → erreurs par champ, au format exact des `details` renvoyés par l'API
 *                           (« types.0.prefix » → code de message) ;
 *   - `collection*()`     → opérations CRUD pures (ajouter, modifier, déplacer, supprimer) +
 *                           détection de clé dupliquée, testables sans rendu.
 *
 * Rien ici ne connaît le rendu : la page et les composants consomment ces fonctions, et les tests
 * vérifient la couverture des modules (chaque section listée a un formulaire complet).
 */
import { z } from 'zod';
import {
  backupZ,
  calendarKindsZ,
  captchaSectionZ,
  gedTypesZ,
  licenseSectionZ,
  practitionerTypesZ,
  securitySettingsZ,
  vaccinationSectionZ,
  workflowsZ,
} from '@sardpi/shared';

/* ------------------------------------------------------------------ types de champs */

export type FieldKind = 'text' | 'number' | 'switch' | 'select' | 'color' | 'password' | 'time' | 'i18n' | 'numbers';

export interface FieldSpec {
  /** Chemin dans l'objet de section : « lockout.maxAttempts », « label » (relatif à une ligne de liste). */
  path: string;
  kind: FieldKind;
  /** Clé i18n du libellé (namespace `settings`). */
  labelKey: string;
  hintKey?: string;
  options?: { value: string; labelKey: string }[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  /**
   * Clé d'une ligne EXISTANTE : verrouillée en édition. Ces clés sont référencées ailleurs (par
   * exemple `appointments.kind`, ou le préfixe d'un code déjà attribué) — les renommer orphelinerait
   * des données. Seules les lignes encore vierges (ajoutées dans la session) restent modifiables.
   */
  lockedOnExisting?: boolean;
}

/** Liste éditable (CRUD) : un tableau d'objets dans la section. */
export interface CollectionSpec {
  /** Chemin du tableau dans l'objet de section (« types », « kinds », « steps », « schedule »). */
  path: string;
  labelKey: string;
  hintKey?: string;
  /** Champ servant de clé unique : sert au contrôle de doublon et à l'identité visuelle. */
  keyField: string;
  /** Champs de chaque entrée (le chemin est relatif à l'entrée). */
  itemFields: FieldSpec[];
  /** Champ d'ordre renuméroté automatiquement après ajout/déplacement/suppression. */
  orderField?: string;
  /** Entrée vierge proposée par « Ajouter ». */
  template: () => Record<string, unknown>;
  /** Nombre maximal d'entrées (garde-fou de saisie, aligné sur les usages du module). */
  max?: number;
  /** Ajout possible ? (ex. statuts du calendrier : liste ouverte) */
  addable?: boolean;
  removable?: boolean;
}

export interface SectionFormSpec {
  groups: { titleKey?: string; hintKey?: string; fields: FieldSpec[] }[];
  collections: CollectionSpec[];
}

/* ------------------------------------------------------------------ schémas (validation partagée) */

/**
 * Schémas utilisés pour valider À L'ÉCRAN ce que l'API validera à l'enregistrement. Les sections
 * purement scalaires déjà couvertes par un formulaire maison (general, ui, smtp, codification,
 * languages, medicalRefs) n'apparaissent pas ici : elles ne passent pas par ce moteur.
 */
const SECTION_SCHEMAS: Record<string, z.ZodTypeAny> = {
  security: securitySettingsZ,
  captcha: captchaSectionZ,
  backups: backupZ,
  license: licenseSectionZ,
  vaccination: vaccinationSectionZ,
  gedTypes: gedTypesZ,
  practitionerTypes: practitionerTypesZ,
  workflowSteps: workflowsZ,
  calendarKinds: calendarKindsZ,
};

/** Schéma de la section, ou undefined si la section n'est pas pilotée par spécification. */
export function sectionSchema(section: string): z.ZodTypeAny | undefined {
  return SECTION_SCHEMAS[section];
}

/** Sections couvertes par le moteur (sert aussi de garde-fou aux tests). */
export const SPEC_SECTIONS: string[] = Object.keys(SECTION_SCHEMAS);

/* ------------------------------------------------------------------ catalogue des formulaires */

const PROVIDER_OPTIONS = [
  { value: 'none', labelKey: 'settings.captcha.none' },
  { value: 'internal', labelKey: 'settings.captcha.internal' },
  { value: 'turnstile', labelKey: 'settings.captcha.turnstile' },
  { value: 'hcaptcha', labelKey: 'settings.captcha.hcaptcha' },
  { value: 'recaptcha', labelKey: 'settings.captcha.recaptcha' },
];

const LICENSE_STATES = [
  { value: 'valid', labelKey: 'settings.license.state.valid' },
  { value: 'trial', labelKey: 'settings.license.state.trial' },
  { value: 'expired', labelKey: 'settings.license.state.expired' },
  { value: 'invalid', labelKey: 'settings.license.state.invalid' },
  { value: 'none', labelKey: 'settings.license.state.none' },
];

/** Libellé multilingue : une entrée par langue gérée par l'application. */
const labelField = (hintKey?: string): FieldSpec => ({ path: 'label', kind: 'i18n', labelKey: 'settings.field.label', hintKey });

export const SECTION_FORMS: Record<string, SectionFormSpec> = {
  /* ---------------------------------------------------------------- sécurité & connexions */
  security: {
    groups: [
      {
        titleKey: 'settings.groups.sessions',
        fields: [
          { path: 'signedUrlTtlMin', kind: 'number', labelKey: 'settings.security.signedUrlTtlMin', hintKey: 'settings.security.signedUrlTtlMin.hint', min: 1, max: 1440 },
          { path: 'encryptSensitiveFields', kind: 'switch', labelKey: 'settings.security.encryptSensitiveFields', hintKey: 'settings.security.encryptSensitiveFields.hint' },
        ],
      },
      {
        titleKey: 'settings.groups.passwords',
        fields: [
          { path: 'passwordMinLength', kind: 'number', labelKey: 'settings.security.passwordMinLength', min: 8, max: 64 },
          { path: 'lockout.maxAttempts', kind: 'number', labelKey: 'settings.security.maxAttempts', min: 3, max: 10 },
          { path: 'lockout.stepsMinutes', kind: 'numbers', labelKey: 'settings.security.stepsMinutes', hintKey: 'settings.security.stepsMinutes.hint' },
        ],
      },
      {
        titleKey: 'settings.groups.access',
        fields: [{ path: 'enforceTotpForAdmin', kind: 'switch', labelKey: 'settings.security.enforceTotpForAdmin', hintKey: 'settings.security.enforceTotpForAdmin.hint' }],
      },
    ],
    collections: [],
  },

  /* ------------------------------------------------------------------------------- captcha */
  captcha: {
    groups: [
      {
        titleKey: 'settings.groups.provider',
        hintKey: 'settings.captcha.hint',
        fields: [
          { path: 'provider', kind: 'select', labelKey: 'settings.captcha.provider', options: PROVIDER_OPTIONS },
          { path: 'sitekey', kind: 'text', labelKey: 'settings.captcha.sitekey', hintKey: 'settings.captcha.sitekey.hint' },
          { path: 'secret', kind: 'password', labelKey: 'settings.captcha.secret', hintKey: 'settings.captcha.secret.hint' },
        ],
      },
    ],
    collections: [],
  },

  /* ---------------------------------------------------------------------------- sauvegardes */
  backups: {
    groups: [
      {
        titleKey: 'settings.groups.schedule',
        fields: [
          { path: 'retentionDays', kind: 'number', labelKey: 'settings.backups.retentionDays', min: 1, max: 999 },
          { path: 'auto', kind: 'switch', labelKey: 'settings.backups.auto', hintKey: 'settings.backups.auto.hint' },
          { path: 'cronTime', kind: 'time', labelKey: 'settings.backups.cronTime', hintKey: 'settings.backups.cronTime.hint' },
        ],
      },
    ],
    collections: [],
  },

  /* -------------------------------------------------------------------------------- licence */
  license: {
    groups: [
      {
        titleKey: 'settings.groups.license',
        fields: [
          { path: 'key', kind: 'password', labelKey: 'settings.license.key', hintKey: 'settings.license.key.hint' },
          { path: 'state', kind: 'select', labelKey: 'settings.license.stateLabel', options: LICENSE_STATES },
          { path: 'expiresAt', kind: 'text', labelKey: 'settings.license.expiresAt', placeholder: 'AAAA-MM-JJ' },
          { path: 'maxUsers', kind: 'number', labelKey: 'settings.license.maxUsers', min: 1, max: 100_000 },
          { path: 'org', kind: 'text', labelKey: 'settings.license.org' },
        ],
      },
    ],
    collections: [],
  },

  /* ------------------------------------------------------------------------ vaccination */
  vaccination: {
    groups: [
      {
        titleKey: 'settings.groups.vaccination',
        fields: [{ path: 'enabled', kind: 'switch', labelKey: 'settings.vaccination.enabled', hintKey: 'settings.vaccination.enabled.hint' }],
      },
    ],
    collections: [
      {
        path: 'schedule',
        labelKey: 'settings.vaccination.schedule',
        hintKey: 'settings.vaccination.schedule.hint',
        keyField: 'key',
        orderField: undefined,
        template: () => ({ key: '', label: { fr: '', ar: '', es: '', en: '' }, ageLabel: '', doses: 1, intervalDays: 0, mandatory: false, active: true }),
        itemFields: [
          { path: 'key', kind: 'text', labelKey: 'settings.field.key', hintKey: 'settings.field.key.hint', lockedOnExisting: true },
          labelField(),
          { path: 'ageLabel', kind: 'text', labelKey: 'settings.vaccination.ageLabel', placeholder: '2 mois' },
          { path: 'doses', kind: 'number', labelKey: 'settings.vaccination.doses', min: 1, max: 10 },
          { path: 'intervalDays', kind: 'number', labelKey: 'settings.vaccination.intervalDays', min: 0, max: 3650, hintKey: 'settings.vaccination.intervalDays.hint' },
          { path: 'mandatory', kind: 'switch', labelKey: 'settings.vaccination.mandatory' },
          { path: 'active', kind: 'switch', labelKey: 'settings.field.active' },
        ],
      },
    ],
  },

  /* ------------------------------------------------------------- types de documents (GED) */
  gedTypes: {
    groups: [],
    collections: [
      {
        path: 'types',
        labelKey: 'settings.gedTypes.types',
        hintKey: 'settings.gedTypes.types.hint',
        keyField: 'prefix',
        template: () => ({ prefix: '', path: '', label: { fr: '', ar: '', es: '', en: '' } }),
        itemFields: [
          { path: 'prefix', kind: 'text', labelKey: 'settings.field.prefix', hintKey: 'settings.field.prefix.hint', lockedOnExisting: true },
          { path: 'path', kind: 'text', labelKey: 'settings.gedTypes.folder', hintKey: 'settings.gedTypes.folder.hint', lockedOnExisting: true },
          labelField(),
        ],
      },
    ],
  },

  /* --------------------------------------------------------------- types de praticiens */
  practitionerTypes: {
    groups: [],
    collections: [
      {
        path: 'types',
        labelKey: 'settings.practitionerTypes.types',
        hintKey: 'settings.practitionerTypes.types.hint',
        keyField: 'prefix',
        template: () => ({ prefix: '', label: { fr: '', ar: '', es: '', en: '' } }),
        itemFields: [
          { path: 'prefix', kind: 'text', labelKey: 'settings.field.prefix', hintKey: 'settings.field.prefix.hint', lockedOnExisting: true },
          labelField(),
        ],
      },
    ],
  },

  /* ----------------------------------------------------------------- étapes du circuit */
  workflowSteps: {
    groups: [
      {
        fields: [{ path: 'allowSkip', kind: 'switch', labelKey: 'settings.workflow.allowSkip', hintKey: 'settings.workflow.allowSkip.hint' }],
      },
    ],
    collections: [
      {
        path: 'steps',
        labelKey: 'settings.workflow.steps',
        hintKey: 'settings.workflow.steps.hint',
        keyField: 'key',
        orderField: 'order',
        template: () => ({ key: '', order: 0, color: '#0ea5b7', label: { fr: '', ar: '', es: '', en: '' } }),
        itemFields: [
          { path: 'key', kind: 'text', labelKey: 'settings.field.key', hintKey: 'settings.field.key.hint', lockedOnExisting: true },
          labelField(),
          { path: 'color', kind: 'color', labelKey: 'settings.field.color' },
        ],
      },
    ],
  },

  /* --------------------------------------------------- étiquettes du calendrier (RDV) */
  calendarKinds: {
    groups: [],
    collections: [
      {
        path: 'kinds',
        labelKey: 'settings.calendarKinds.kinds',
        hintKey: 'settings.calendarKinds.kinds.hint',
        keyField: 'key',
        orderField: 'order',
        template: () => ({ key: '', order: 0, color: '#3b82f6', durationMin: 30, active: true, label: { fr: '', ar: '', es: '', en: '' } }),
        itemFields: [
          { path: 'key', kind: 'text', labelKey: 'settings.field.key', hintKey: 'settings.calendarKinds.keyHint', lockedOnExisting: true },
          labelField(),
          { path: 'color', kind: 'color', labelKey: 'settings.field.color' },
          { path: 'durationMin', kind: 'number', labelKey: 'settings.calendarKinds.durationMin', min: 5, max: 480 },
          { path: 'active', kind: 'switch', labelKey: 'settings.field.active' },
        ],
      },
      {
        path: 'statuses',
        labelKey: 'settings.calendarKinds.statuses',
        hintKey: 'settings.calendarKinds.statuses.hint',
        keyField: 'key',
        orderField: 'order',
        template: () => ({ key: '', order: 0, color: '#64748b', label: { fr: '', ar: '', es: '', en: '' } }),
        itemFields: [
          { path: 'key', kind: 'text', labelKey: 'settings.field.key', hintKey: 'settings.calendarKinds.statusKeyHint', lockedOnExisting: true },
          labelField(),
          { path: 'color', kind: 'color', labelKey: 'settings.field.color' },
        ],
      },
    ],
  },
};

/* ------------------------------------------------------------------ accès par chemin */

export function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), obj);
}

/** Écriture IMMUABLE (les objets de section viennent d'une requête : on ne les mute jamais). */
export function setPath<T extends Record<string, unknown>>(obj: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split('.');
  const out: Record<string, unknown> = { ...obj };
  out[head!] = rest.length ? setPath((out[head!] as Record<string, unknown>) ?? {}, rest.join('.'), value) : value;
  return out as T;
}

/* ------------------------------------------------------------------ validation par champ */

/** Codes de message portés par les schémas partagés (regex/temps personnalisés). */
const CUSTOM_CODES = new Set(['gedPrefix', 'gedPath', 'stepKey', 'kindKey', 'vaccineKey', 'time', 'duplicateKey']);

/** Traduit un problème Zod en code de message i18n (`settings.validation.<code>`). */
export function issueCode(issue: z.ZodIssue): string {
  if (CUSTOM_CODES.has(issue.message)) return issue.message;
  switch (issue.code) {
    case 'too_small':
      return 'tooSmall';
    case 'too_big':
      return 'tooBig';
    case 'invalid_type':
      return 'required';
    case 'invalid_enum_value':
      return 'enum';
    case 'invalid_string':
      return issue.validation === 'regex' ? 'pattern' : 'invalid';
    case 'invalid_union':
      return 'invalid';
    default:
      return 'invalid';
  }
}

/** Variables d'interpolation utiles au message (bornes, type attendu). */
export function issueVars(issue: z.ZodIssue): Record<string, string | number> {
  const src = issue as unknown as { minimum?: number; maximum?: number; expected?: string };
  const vars: Record<string, string | number> = {};
  if (src.minimum !== undefined) vars.min = src.minimum;
  if (src.maximum !== undefined) vars.max = src.maximum;
  if (src.expected) vars.type = src.expected;
  return vars;
}

/**
 * Erreurs par champ — MÊME FORME que les `details` de l'API (`zodDetails`) : chemin pointé → code.
 * Le formulaire n'a donc qu'un seul vocabulaire d'erreur, qu'elle vienne du navigateur ou du serveur.
 */
export function issuesByPath(section: string, data: unknown): Record<string, string> {
  const schema = sectionSchema(section);
  if (!schema) return {};
  const res = schema.safeParse(data);
  if (res.success) return {};
  const out: Record<string, string> = {};
  for (const issue of res.error.issues) {
    const key = issue.path.join('.') || '_';
    if (!out[key]) out[key] = issueCode(issue);
  }
  return out;
}

/** Les variables d'interpolation par chemin (bornes), pour composer le message affiché. */
export function issuesVarsByPath(section: string, data: unknown): Record<string, Record<string, string | number>> {
  const schema = sectionSchema(section);
  if (!schema) return {};
  const res = schema.safeParse(data);
  if (res.success) return {};
  const out: Record<string, Record<string, string | number>> = {};
  for (const issue of res.error.issues) {
    const key = issue.path.join('.') || '_';
    if (!out[key]) out[key] = issueVars(issue);
  }
  return out;
}

/**
 * Validation d'un texte JSON saisi à la main : mêmes règles que le formulaire (et que l'API), avec
 * les bornes attendues pour composer un message lisible (« chemin » → code + variables).
 */
export function validateJsonText(
  section: string,
  text: string,
): { ok: true; value: unknown } | { ok: false; errors: Record<string, string>; vars: Record<string, Record<string, string | number>> } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, errors: { _: 'jsonSyntax' }, vars: {} };
  }
  const errors = issuesByPath(section, parsed);
  if (Object.keys(errors).length) return { ok: false, errors, vars: issuesVarsByPath(section, parsed) };
  const schema = sectionSchema(section);
  return { ok: true, value: schema ? schema.parse(parsed) : parsed };
}

/* ------------------------------------------------------------------ opérations CRUD (pures) */

/** Index du premier doublon de clé (hors ligne en cours d'édition), -1 si la clé est libre. */
export function duplicateKeyIndex(items: Record<string, unknown>[], keyField: string, value: string, ignoreIndex = -1): number {
  const needle = String(value ?? '').trim();
  if (!needle) return -1;
  return items.findIndex((it, i) => i !== ignoreIndex && String(it[keyField] ?? '').trim() === needle);
}

/** Renumérote le champ d'ordre (1…n) — l'ordre est la position dans la liste, jamais saisi à la main. */
export function renumber(items: Record<string, unknown>[], orderField?: string): Record<string, unknown>[] {
  if (!orderField) return items;
  return items.map((it, i) => ({ ...it, [orderField]: i + 1 }));
}

export function collectionAdd(items: Record<string, unknown>[], spec: CollectionSpec): Record<string, unknown>[] {
  if (spec.max && items.length >= spec.max) return items;
  return renumber([...items, spec.template()], spec.orderField);
}

export function collectionUpdate(items: Record<string, unknown>[], index: number, patch: Record<string, unknown>, spec: CollectionSpec): Record<string, unknown>[] {
  return renumber(
    items.map((it, i) => (i === index ? { ...it, ...patch } : it)),
    spec.orderField,
  );
}

export function collectionRemove(items: Record<string, unknown>[], index: number, spec: CollectionSpec): Record<string, unknown>[] {
  return renumber(
    items.filter((_, i) => i !== index),
    spec.orderField,
  );
}

/** Déplace une entrée (réordonnancement du circuit de soins / des étiquettes). */
export function collectionMove(items: Record<string, unknown>[], index: number, direction: -1 | 1, spec: CollectionSpec): Record<string, unknown>[] {
  const target = index + direction;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return items;
  const next = [...items];
  const [row] = next.splice(index, 1);
  next.splice(target, 0, row!);
  return renumber(next, spec.orderField);
}

/** Valeur par défaut affichée pour un champ absent (jamais « undefined » à l'écran). */
export function fieldValue(item: Record<string, unknown>, field: FieldSpec): unknown {
  const v = getPath(item, field.path);
  switch (field.kind) {
    case 'switch':
      return v === true || v === 1 || v === '1' || v === 'true';
    case 'number':
      return typeof v === 'number' ? v : v === undefined || v === null || v === '' ? '' : Number(v);
    case 'numbers':
      return Array.isArray(v) ? v.join(', ') : '';
    case 'i18n':
      return v && typeof v === 'object' ? (v as Record<string, string>) : {};
    default:
      return v === undefined || v === null ? '' : String(v);
  }
}

/** Valeur à écrire à partir de la saisie (conversion de type au fil de la frappe). */
export function fieldParse(field: FieldSpec, raw: string | boolean): unknown {
  if (field.kind === 'switch') return Boolean(raw);
  if (field.kind === 'number') {
    const s = String(raw).trim();
    if (!s) return undefined; // jamais NaN : un champ vidé laisse la clé absente (le schéma applique son défaut)
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  }
  if (field.kind === 'numbers') {
    return String(raw)
      .split(/[,;\s]+/)
      .map((x) => x.trim())
      .filter((x) => x !== '')
      .map(Number)
      .filter((n) => Number.isFinite(n));
  }
  return raw;
}

/** Libellé d'une entrée : première valeur non vide du champ `label` (multilingue). */
export function itemTitle(item: Record<string, unknown>, keyField: string, langs: readonly string[] = ['fr', 'ar', 'es', 'en']): string {
  const label = item.label as Record<string, string> | undefined;
  const first = langs.map((l) => label?.[l]).find((x) => x && x.trim());
  return first ?? String(item[keyField] ?? '');
}
