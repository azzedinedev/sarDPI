/**
 * Schémas Zod PARTAGÉS front/back (validation unique, source de vérité des formulaires et des APIs).
 * Règle : `id` numérique auto-incrémenté généré côté serveur ; `code` idem ; jamais envoyés en create.
 */
import { z } from 'zod';

/* ------------------------------------------------------------------ communs */

export const idZ = z.coerce.number().int().positive();
export const multiLabelZ = z
  .object({ fr: z.string().min(1).max(160), ar: z.string().max(160).optional(), es: z.string().max(160).optional(), en: z.string().max(160).optional() })
  .partial({ ar: true, es: true, en: true });
export const codeZ = z.string().regex(/^[A-Z0-9-]{3,64}$/, 'format de code invalide');

export const paginationZ = z.object({
  q: z.string().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
  sortBy: z.string().max(40).optional(),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
  /** filtres avancés sérialisés (voir filterGroupZ) */
  filters: z.string().max(4000).optional(),
  scope: z.enum(['active', 'archived', 'all']).default('active'),
});
export type Pagination = z.infer<typeof paginationZ>;

export const filterOpZ = z.enum(['contains', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'empty', 'notEmpty', 'in']);
export const filterZ = z.object({
  field: z.string().min(1).max(40),
  op: filterOpZ,
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]).optional(),
  value2: z.union([z.string(), z.number()]).optional(),
});
export const filterGroupZ = z.object({ combinator: z.enum(['AND', 'OR']), items: z.array(filterZ).max(20) });
export type FilterItem = z.infer<typeof filterZ>;
export type FilterGroup = z.infer<typeof filterGroupZ>;

/* ------------------------------------------------------------------ patient */

export const sexZ = z.enum(['M', 'F']);
export const bloodGroups = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'] as const;

export const patientBaseZ = z.object({
  firstName: z.string().min(1, 'required').max(80),
  lastName: z.string().min(1, 'required').max(80),
  firstNameAr: z.string().max(80).optional().nullable(),
  lastNameAr: z.string().max(80).optional().nullable(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  sex: sexZ.default('M'),
  wilayaCode: z.coerce.number().int().min(1).max(58).optional().nullable(),
  daira: z.string().max(80).optional().nullable(),
  commune: z.string().max(80).optional().nullable(),
  address: z.string().max(200).optional().nullable(),
  phone: z.string().max(24).optional().nullable(),
  email: z.string().email().max(120).optional().or(z.literal('')).nullable(),
  // Identifiants ALGÉRIENS — tous optionnels, validés par le profil pays côté serveur
  nin: z.string().regex(/^[0-9]{18}$/, 'NIN : 18 chiffres').optional().nullable(),
  ssFund: z.preprocess((v) => (v === '' ? null : v), z.string().max(14).optional().nullable()),
  ssNumber: z.string().max(24).optional().nullable(),
  chifaNumber: z.string().max(24).optional().nullable(),
  havingRight: z.coerce.boolean().optional().nullable(),
  thirdPartyPayer: z.coerce.boolean().optional().nullable(),
  emergencyName: z.string().max(120).optional().nullable(),
  emergencyPhone: z.string().max(24).optional().nullable(),
  emergencyRelation: z.string().max(40).optional().nullable(),
  bloodGroup: z.preprocess((v) => (v === '' ? null : v), z.enum(bloodGroups).or(z.string().max(12)).optional().nullable()),
  allergies: z.union([z.string().max(40000), z.array(z.string().max(120)).max(50)]).optional().nullable(),
  antecedents: z.union([z.string().max(40000), z.array(z.string().max(120)).max(50)]).optional().nullable(),
  attendingPractitionerId: z.coerce.number().int().positive().optional().nullable(),
  preferredLocale: z.enum(['ar', 'fr', 'es', 'en']).default('fr'),
  country: z.string().length(2).default('DZ'),
  notes: z.string().max(40000).optional().nullable(),
  consent: z
    .object({
      granted: z.boolean(),
      grantedAt: z.string().optional().nullable(),
      scopes: z.array(z.string().max(40)).default(['care', 'documents']),
      revokedAt: z.string().optional().nullable(),
    })
    .optional(),
});
export const patientCreateZ = patientBaseZ;
export const patientUpdateZ = patientBaseZ;
export type PatientInput = z.infer<typeof patientBaseZ>;

/* ---------------------------------------------------------------- intervenant */

export const practitionerBaseZ = z.object({
  typePrefix: z.string().regex(/^[A-Z]{2,5}$/), // MED, INF… (préfixe du type → code)
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  firstNameAr: z.string().max(80).optional().nullable(),
  lastNameAr: z.string().max(80).optional().nullable(),
  email: z.string().email().max(120).optional().or(z.literal('')).nullable(),
  phone: z.string().max(24).optional().nullable(),
  orderNumber: z.string().max(24).optional().nullable(), // n° Ordre (CNOM…)
  speciality: multiLabelZ.optional(),
  userId: z.coerce.number().int().positive().optional().nullable(),
  signatureAssetId: z.coerce.number().int().positive().optional().nullable(),
  stampAssetId: z.coerce.number().int().positive().optional().nullable(),
  availability: z.string().max(240).optional().nullable(),
  active: z.coerce.boolean().default(true),
});
export type PractitionerInput = z.infer<typeof practitionerBaseZ>;

/* ---------------------------------------------------------------------- lieu */

export const locationKinds = ['cabinet', 'salle', 'bloc', 'labo', 'pharmacie', 'service', 'autre'] as const;
export const locationBaseZ = z.object({
  kind: z.enum(locationKinds).default('cabinet'),
  name: multiLabelZ,
  capacity: z.coerce.number().int().min(0).max(500).default(1),
  building: z.string().max(120).optional().nullable(),
  address: z.string().max(200).optional().nullable(),
  wilayaCode: z.coerce.number().int().min(1).max(58).optional().nullable(),
  openHours: z
    .record(z.string(), z.array(z.object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) })))
    .optional(),
  active: z.coerce.boolean().default(true),
});
export type LocationInput = z.infer<typeof locationBaseZ>;

/* ------------------------------------------- types d'intervention configurables */

export const fieldKindZ = z.enum(['text', 'textarea', 'number', 'date', 'datetime', 'bool', 'select', 'multiselect', 'file', 'list', 'json']);
export const fieldDefZ = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/),
  kind: fieldKindZ,
  label: multiLabelZ,
  required: z.boolean().default(false),
  options: z.array(z.string().max(60)).optional(),
  unit: z.string().max(16).optional(),
  help: multiLabelZ.optional(),
});
export type FieldDef = z.infer<typeof fieldDefZ>;

export const recordStatusZ = z.string().regex(/^[a-z_]{2,30}$/);

export const interventionTypeBaseZ = z.object({
  categoryPrefix: z.string().regex(/^[A-Z]{2,5}$/),
  code: z.string().regex(/^[a-z][a-z0-9_]{2,40}$/), // ex. 'ecg', 'nfs'
  name: multiLabelZ,
  description: multiLabelZ.optional(),
  fields: z.array(fieldDefZ).default([]),
  statuses: z.array(z.string().regex(/^[a-z_]{2,30}$/)).default(['draft', 'validated']),
  defaultStatus: z.string().default('draft'),
  views: z
    .object({
      formColumns: z.number().int().min(1).max(3).default(2),
      listColumns: z.array(z.string().max(40)).default([]),
      cardTitle: z.string().max(40).optional(),
    })
    .default({ formColumns: 2, listColumns: [] }),
  pdfTemplate: z.enum(['auto', 'report', 'lab', 'rx', 'certificate', 'none']).default('report'),
  requireVerifyToken: z.boolean().default(true),
  active: z.coerce.boolean().default(true),
});
export type InterventionTypeInput = z.infer<typeof interventionTypeBaseZ>;

/** Fiche médicale (création) : le code combiné est calculé serveur. */
export const medicalRecordCreateZ = z.object({
  patientId: idZ,
  typeId: idZ,
  /** rendez-vous associé (agenda → action dans le dossier) — facultatif */
  apptId: idZ.optional().nullable(),
  actDate: z.string().min(8).max(32), // date locale ISO (date ou datetime)
  status: recordStatusZ.default('draft'),
  summary: multiLabelZ.partial().optional(),
  practitionerIds: z.array(idZ).default([]),
  locationId: idZ.optional().nullable(),
  values: z.array(z.object({ parameterKey: z.string().max(40), value: z.union([z.string().max(60), z.number()]), unit: z.string().max(16).optional() })).optional(),
  fields: z.record(z.string(), z.union([z.string().max(4000), z.number(), z.boolean(), z.null()])).default({}),
  attachments: z.array(z.string().regex(/^[A-Z]{2,5}-\d{3,8}$/)).default([]), // codes GED
  icd10: z.array(z.string().regex(/^[A-Z]\d{1,4}(\.\d{1,2})?$/)).max(20).default([]),
});
export const medicalRecordUpdateZ = medicalRecordCreateZ.omit({ patientId: true, typeId: true });
export type MedicalRecordInput = z.infer<typeof medicalRecordCreateZ>;

/* ---------------------------------------------------------------------- GED */

export const gedMetaZ = z.object({
  typePrefix: z.string().regex(/^[A-Z]{2,5}$/),
  title: z.string().min(1).max(160),
  patientId: idZ.optional().nullable(),
  recordId: idZ.optional().nullable(),
  tags: z.array(z.string().max(30)).max(12).default([]),
  note: z.string().max(1000).optional().nullable(),
});
export type GedMetaInput = z.infer<typeof gedMetaZ>;

/* ---------------------------------------------------------------- ordonnance */

export const rxLineZ = z.object({
  drugId: idZ.optional().nullable(),
  dci: z.string().max(80).optional().nullable(),
  tradeName: z.string().min(1).max(80),
  form: z.string().max(40).optional().nullable(),
  dosage: z.string().max(40).optional().nullable(),
  quantity: z.coerce.number().int().min(1).max(999).default(1),
  posology: z.string().max(240).min(1),
  durationDays: z.coerce.number().int().min(1).max(365).default(7),
  instructions: z.string().max(240).optional().nullable(),
});
export const rxCreateZ = z.object({
  patientId: idZ,
  practitionerId: idZ,
  actDate: z.string().min(8).max(32),
  templateId: idZ.optional().nullable(),
  locale: z.enum(['ar', 'fr', 'es', 'en']).optional(),
  lines: z.array(rxLineZ).min(1).max(30),
  notes: z.string().max(1000).optional().nullable(),
  refills: z.coerce.number().int().min(0).max(12).default(0),
});
export type RxInput = z.infer<typeof rxCreateZ>;

/** Édition d'une ordonnance existante — refusée serveur si verrouillée/validée (sauf admin). */
export const rxUpdateZ = z.object({
  practitionerId: idZ.optional().nullable(),
  actDate: z.string().min(8).max(32).optional(),
  status: z.enum(['draft', 'validated', 'cancelled']).optional(),
  lines: z.array(rxLineZ).min(1).max(30).optional(),
  notes: z.string().max(1000).optional().nullable(),
  refills: z.coerce.number().int().min(0).max(12).optional(),
});
export type RxUpdateInput = z.infer<typeof rxUpdateZ>;

export const rxTemplateZ = z.object({
  name: z.string().min(1).max(80),
  header: z.object({ clinicName: z.string().max(120).optional(), address: z.string().max(200).optional(), phone: z.string().max(40).optional(), email: z.string().max(120).optional(), logoAssetId: z.coerce.number().int().optional().nullable() }).default({}),
  footer: z.string().max(300).optional(),
  colors: z.object({ primary: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#0ea5b7'), accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#34c77b') }).default({ primary: '#0ea5b7', accent: '#34c77b' }),
  bilingual: z.boolean().default(true),
  showQr: z.boolean().default(true),
  showStamp: z.boolean().default(true),
  numbering: z.enum(['latn', 'arab']).default('latn'),
});
export type RxTemplateInput = z.infer<typeof rxTemplateZ>;

/* ---------------------------------------------------------------- rendez-vous */

export const appointmentBaseZ = z.object({
  patientId: idZ,
  practitionerId: idZ.optional().nullable(),
  locationId: idZ.optional().nullable(),
  startAt: z.string().min(16).max(32),
  endAt: z.string().min(16).max(32),
  kind: z.string().max(40).default('consultation'),
  status: z.enum(['pending', 'confirmed', 'done', 'cancelled', 'no_show']).default('pending'),
  notes: z.string().max(500).optional().nullable(),
  allDay: z.coerce.boolean().default(false),
});
export type AppointmentInput = z.infer<typeof appointmentBaseZ>;

/* ------------------------------------------------------ workflow & mouvements */

export const caseWorkflowZ = z.object({
  patientId: idZ,
  title: z.string().max(120).optional().nullable(),
});
export const caseStepZ = z.object({
  caseId: idZ,
  stepKey: z.string().regex(/^[a-z_]{2,40}$/),
  status: z.enum(['todo', 'in_progress', 'done', 'skipped']).default('todo'),
  plannedAt: z.string().optional().nullable(),
  doneAt: z.string().optional().nullable(),
  locationId: idZ.optional().nullable(),
  practitionerIds: z.array(idZ).default([]),
  documents: z.array(z.string().regex(/^[A-Z]{2,5}-\d{3,8}$/)).default([]),
  note: z.string().max(600).optional().nullable(),
});
export const movementZ = z.object({
  patientId: idZ,
  fromLocationId: idZ.optional().nullable(),
  toLocationId: idZ,
  reason: z.string().max(200).optional().nullable(),
  status: z.enum(['pending', 'in_transit', 'arrived']).default('pending'),
  at: z.string().optional().nullable(),
  responsiblePractitionerId: idZ.optional().nullable(),
});

/* -------------------------------------------------------------------- admin */

export const userCreateZ = z.object({
  username: z.string().min(3).max(40).regex(/^[a-z0-9._-]+$/),
  email: z.string().email(),
  fullName: z.string().min(2).max(120),
  password: z.string().min(10).max(128),
  roleId: idZ,
  locale: z.enum(['ar', 'fr', 'es', 'en']).default('fr'),
  active: z.coerce.boolean().default(true),
  phone: z.string().max(24).optional().nullable(),
});
export const userUpdateZ = userCreateZ.omit({ password: true }).partial();
export const passwordPolicyZ = z.string().min(10).max(128).regex(/^(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).+$/, 'password_policy');

export const roleUpdateZ = z.object({ name: multiLabelZ, perms: z.array(z.string().max(60)).max(400) });

export const loginZ = z.object({
  identifier: z.string().min(2).max(120),
  password: z.string().min(1).max(128),
  remember: z.coerce.boolean().default(true),
  captchaId: z.string().optional(),
  captchaValue: z.string().max(40).optional(),
  turnstileToken: z.string().max(2000).optional(),
  hcaptchaToken: z.string().max(2000).optional(),
  recaptchaToken: z.string().max(2000).optional(),
  totp: z.string().regex(/^\d{6}$/).optional(),
});

/* ------------------------------------------------------------------ sécurité */

export const captchaProviders = ['none', 'internal', 'turnstile', 'hcaptcha', 'recaptcha'] as const;
export const securitySettingsZ = z.object({
  captcha: z.object({ provider: z.enum(captchaProviders).default('internal'), sitekey: z.string().max(120).optional(), secret: z.string().max(200).optional() }).default({ provider: 'internal' }),
  passwordMinLength: z.number().int().min(8).max(64).default(10),
  lockout: z.object({ maxAttempts: z.number().int().min(3).max(10).default(5), stepsMinutes: z.array(z.number().int().min(1)).default([1, 5, 15, 60]) }).default({ maxAttempts: 5, stepsMinutes: [1, 5, 15, 60] }),
  enforceTotpForAdmin: z.boolean().default(false),
  signedUrlTtlMin: z.number().int().min(1).max(1440).default(15),
  encryptSensitiveFields: z.boolean().default(true),
});
export type SecuritySettings = z.infer<typeof securitySettingsZ>;

export const smtpSettingsZ = z.object({
  enabled: z.boolean().default(false),
  host: z.string().max(120).optional(),
  port: z.number().int().min(1).max(65535).default(465),
  secure: z.boolean().default(true),
  user: z.string().max(120).optional(),
  password: z.string().max(200).optional(),
  from: z.string().max(160).default('"Clinique" <no-reply@clinic.dz>'),
});
export type SmtpSettings = z.infer<typeof smtpSettingsZ>;
