/**
 * PARAMÈTRES typés par section, avec défauts + validation Zod + cache (tag « settings »)
 * et invalidation croisée multi-processus (table cache_versions). Les secrets (smtp.password,
 * captcha.secret, clés d'API) ne sortent JAMAIS en clair de l'API (masqués «••••», réécriture par "" = inchangé).
 */
import { z } from 'zod';
import { env, paths } from '../config';
import { getDb } from '../data';
import {
  DEFAULT_GED_TYPES,
  DEFAULT_PRACTITIONER_TYPES,
  DEFAULT_BLOOD_GROUPS,
  DEFAULT_SS_FUNDS,
  medicalRefsZ,
  smtpSettingsZ,
  securitySettingsZ,
  backupZ,
  calendarKindsZ,
  captchaSectionZ,
  gedTypesZ,
  licenseSectionZ,
  practitionerTypesZ,
  vaccinationSectionZ,
  workflowsZ,
  type CodificationConfig,
} from '@sardpi/shared';
import { cacheGet, cacheSet, bumpTag } from '../cache';

/* --------------------------------------------------------------- définitions */

export const generalZ = z.object({
  appName: z.string().max(60).default('sarDPI'),
  orgName: z.string().max(140).default('Clinique Demo — Alger'),
  orgAddress: z.string().max(200).default('Cité des Oliviers, Bt. 4 — Bab Ezzouar, Alger'),
  orgPhone: z.string().max(30).default('+213 23 55 55 55'),
  orgEmail: z.string().max(120).default('contact@clinique-demo.dz'),
  legalNotice: z.string().max(600).default('Données protégées — loi 18-07 (Algérie), autorité ANPDP.'),
  country: z.string().length(2).default('DZ'),
  // Format d'affichage des dates (les valeurs stockées restent ISO 8601 ; PDF/exports CSV bruts gardent l'ISO).
  dateDisplay: z.enum(['DD/MM/YYYY', 'DD-MM-YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']).default('DD/MM/YYYY'),
  timeDisplay: z.boolean().default(true),
  footerNote: z.string().max(200).default(''),
});
export const uiZ = z.object({
  theme: z.string().regex(/^[a-z0-9_-]{2,40}$/).default('medical-blue'),
  density: z.enum(['comfortable', 'compact']).default('comfortable'),
  nav: z.enum(['sidebar', 'topbar']).default('sidebar'),
  animations: z.enum(['full', 'reduced', 'off']).default('full'),
  parallax: z.boolean().default(true),
  arabicDigits: z.boolean().default(false),
  hijriEnabled: z.boolean().default(true),
});
export const codificationZ = z.object({
  ...Object.fromEntries(
    Object.entries({
      patientPrefix: z.string().regex(/^[A-Z]{1,6}$/).default('PAT'),
      patientPadding: z.number().int().min(3).max(8).default(5),
      separator: z.enum(['-', '.', '_']).default('-'),
      datePattern: z.enum(['YYYYMMDD', 'YYMMDD', 'DDMMYYYY']).default('YYYYMMDD'),
      recordSeqPadding: z.number().int().min(2).max(3).default(2),
      gedPadding: z.number().int().min(4).max(8).default(6),
      practitionerPadding: z.number().int().min(3).max(8).default(5),
      locationPadding: z.number().int().min(2).max(6).default(3),
      genericPadding: z.number().int().min(3).max(8).default(5),
    }),
  ),
  /** Surcharge de préfixe par catégorie / type GED / type intervenant : { 'category:LAB':'LABO', 'ged:ANL':'ANALYSE' } */
  prefixOverrides: z.record(z.string(), z.string().regex(/^[A-Z]{1,8}$/)).default({}),
  drugPadding: z.number().int().min(4).max(8).default(6),
});
export const languagesSectionZ = z.object({ default: z.string().default(env.defaultLocale), fallback: z.string().default('fr'), enabled: z.array(z.string()).default(['ar', 'fr', 'es', 'en']) });
export type GeneralSettings = z.infer<typeof generalZ>;
export type UiSettings = z.infer<typeof uiZ>;
export type CodificationSettings = z.infer<typeof codificationZ> & CodificationConfig;

const SECRET_MASK = '••••••';

/** Section -> {schéma, valeurs par défaut, secrets} */
const SECTIONS = {
  general: { zod: generalZ },
  ui: { zod: uiZ },
  codification: { zod: codificationZ },
  gedTypes: { zod: gedTypesZ, factory: () => ({ types: DEFAULT_GED_TYPES.map((t) => ({ ...t })) }) },
  medicalRefs: { zod: medicalRefsZ, factory: () => ({ bloodGroups: DEFAULT_BLOOD_GROUPS.map((t) => ({ ...t })), ssFunds: DEFAULT_SS_FUNDS.map((t) => ({ ...t })) }) },
  practitionerTypes: { zod: practitionerTypesZ, factory: () => ({ types: DEFAULT_PRACTITIONER_TYPES.map((t) => ({ ...t })) }) },
  languages: { zod: languagesSectionZ },
  workflowSteps: {
    zod: workflowsZ,
    factory: () => ({
      allowSkip: true,
      steps: [
        { key: 'admission', order: 1, color: '#0ea5b7', label: { fr: 'Accueil', ar: 'الاستقبال', es: 'Admisión', en: 'Reception' } },
        { key: 'consultation', order: 2, color: '#3b82f6', label: { fr: 'Consultation', ar: 'استشارة', es: 'Consulta', en: 'Consultation' } },
        { key: 'exams', order: 3, color: '#8b5cf6', label: { fr: 'Examens', ar: 'فحوصات', es: 'Pruebas', en: 'Exams' } },
        { key: 'diagnosis', order: 4, color: '#f59e0b', label: { fr: 'Diagnostic', ar: 'تشخيص', es: 'Diagnóstico', en: 'Diagnosis' } },
        { key: 'treatment', order: 5, color: '#10b981', label: { fr: 'Traitement', ar: 'علاج', es: 'Tratamiento', en: 'Treatment' } },
        { key: 'followup', order: 6, color: '#14b8a6', label: { fr: 'Suivi', ar: 'متابعة', es: 'Seguimiento', en: 'Follow-up' } },
        { key: 'closure', order: 7, color: '#64748b', label: { fr: 'Clôture', ar: 'إغلاق', es: 'Cierre', en: 'Closure' } },
      ],
    }),
  },
  calendarKinds: {
    zod: calendarKindsZ,
    // Valeurs par défaut = celles qui étaient codées en dur dans le calendrier.
    factory: () => ({
      kinds: [
        { key: 'consultation', order: 1, color: '#3b82f6', durationMin: 30, active: true, label: { fr: 'Consultation', ar: 'استشارة', es: 'Consulta', en: 'Consultation' } },
        { key: 'control', order: 2, color: '#14b8a6', durationMin: 20, active: true, label: { fr: 'Visite de contrôle', ar: 'زيارة متابعة', es: 'Visita de control', en: 'Follow-up' } },
        { key: 'procedure', order: 3, color: '#8b5cf6', durationMin: 45, active: true, label: { fr: 'Procédure', ar: 'إجراء', es: 'Procedimiento', en: 'Procedure' } },
        { key: 'lab', order: 4, color: '#f59e0b', durationMin: 15, active: true, label: { fr: 'Analyse', ar: 'تحليل', es: 'Análisis', en: 'Lab test' } },
        { key: 'radio', order: 5, color: '#0ea5b7', durationMin: 30, active: true, label: { fr: 'Radiologie', ar: 'أشعة', es: 'Radiología', en: 'Imaging' } },
      ],
      statuses: [
        { key: 'pending', order: 1, color: '#f59e0b', label: { fr: 'En attente', ar: 'قيد الانتظار', es: 'Pendiente', en: 'Pending' } },
        { key: 'confirmed', order: 2, color: '#3b82f6', label: { fr: 'Confirmé', ar: 'مؤكد', es: 'Confirmado', en: 'Confirmed' } },
        { key: 'done', order: 3, color: '#10b981', label: { fr: 'Terminé', ar: 'تم', es: 'Hecho', en: 'Done' } },
        { key: 'cancelled', order: 4, color: '#ef4444', label: { fr: 'Annulé', ar: 'ملغى', es: 'Cancelado', en: 'Cancelled' } },
        { key: 'no_show', order: 5, color: '#64748b', label: { fr: 'Non présenté', ar: 'لم يحضر', es: 'No presentado', en: 'No show' } },
      ],
    }),
  },
  smtp: { zod: smtpSettingsZ, secretKeys: ['password'] },
  captcha: { zod: captchaZ(), secretKeys: ['secret'] },
  security: { zod: securitySettingsZ.extend({ enforceTotpForAdmin: z.boolean().default(false) }) },
  backups: { zod: backupZ },
  license: { zod: licenseZ() },
  vaccination: { zod: vaccinationSectionZ },
} as const;

/**
 * Le schéma captcha est partagé avec le formulaire d'administration (`@sardpi/shared`), mais la
 * valeur par défaut du fournisseur reste celle de l'ENVIRONNEMENT : `resolveProvider()` lit la
 * section puis retombe sur `env.captchaProvider`, ce qui ne fonctionne que si rien n'est imposé
 * côté schéma. On l'ajoute donc ici, au moment où le serveur enregistre la section.
 */
function captchaZ() {
  return captchaSectionZ.extend({ provider: captchaSectionZ.shape.provider.default(env.captchaProvider) });
}
function licenseZ() {
  return licenseSectionZ;
}

export type SectionName = keyof typeof SECTIONS;
export const SECTION_NAMES = Object.keys(SECTIONS) as SectionName[];

/* -------------------------------------------------------------- lecture/écriture */

async function loadSection<K extends SectionName>(section: K): Promise<Record<string, unknown>> {
  const def = SECTIONS[section] as { zod: z.ZodTypeAny; factory?: () => object; secretKeys?: string[] };
  const fallback = (def.factory ? def.factory() : {}) as Record<string, unknown>;
  const mergedBase = def.zod.parse(fallback);
  const db = await getDb();
  const row = await db.findOne('settings', { key: section });
  if (!row) return mergedBase as Record<string, unknown>;
  const stored = typeof row.value_json === 'string' ? JSON.parse(String(row.value_json)) : row.value_json;
  try {
    return def.zod.parse({ ...fallback, ...(stored as object) });
  } catch (e) {
    // Paramètre corrompu → l'ancien schéma par défaut garde la main (l'app ne casse jamais)
    console.error(`[settings] section ${section} invalide, repli sur les défauts :`, (e as Error).message);
    return mergedBase as Record<string, unknown>;
  }
}

const MEM_TTL = 30_000;
export async function getSection<K extends SectionName>(section: K, opts: { fresh?: boolean } = {}): Promise<Awaited<ReturnType<typeof loadSection<K>>>> {
  const ck = `settings:${section}`;
  if (!opts.fresh) {
    const cached = cacheGet<Record<string, unknown>>('settings', ck);
    if (cached) return cached as Awaited<ReturnType<typeof loadSection<K>>>;
  }
  const v = await loadSection(section);
  cacheSet('settings', ck, v, MEM_TTL);
  return v;
}

export async function getCodification(): Promise<CodificationSettings> {
  return (await getSection('codification')) as unknown as CodificationSettings;
}

function maskSecrets(section: string, value: Record<string, unknown>, secretKeys: string[]): Record<string, unknown> {
  if (!secretKeys?.length) return value;
  const out = { ...value };
  for (const k of secretKeys) if (out[k]) out[k] = SECRET_MASK;
  return out;
}
function unmask(section: string, incoming: Record<string, unknown>, secretKeys?: string[]): Record<string, unknown> {
  if (!secretKeys?.length) return incoming;
  const out = { ...incoming };
  for (const k of secretKeys) {
    if (out[k] === SECRET_MASK || out[k] === '') {
      // le client renvoie le masque → on conserve la valeur stockée
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (out as any)[k];
    }
  }
  return out;
}

/** GET admin : toutes les sections, secrets masqués. */
export async function getAll(mask = true): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const name of SECTION_NAMES) {
    const v = await getSection(name);
    const def = SECTIONS[name] as { secretKeys?: string[] };
    out[name] = mask ? maskSecrets(name, v, def.secretKeys ?? []) : v;
  }
  return out;
}

export async function saveSection(section: SectionName, value: Record<string, unknown>, actorId?: number): Promise<Record<string, unknown>> {
  const def = SECTIONS[section] as { zod: z.ZodTypeAny; secretKeys?: string[] };
  const db = await getDb();
  const prev = (await db.findOne('settings', { key: section }))?.value_json;
  const prevObj = (typeof prev === 'string' ? JSON.parse(prev) : prev ?? {}) as Record<string, unknown>;
  const unmasked = unmask(section, value, def.secretKeys ?? []);
  // Captcha : si le fournisseur change, les clés de l'ancien ne doivent pas fuiter vers le nouveau
  const base =
    section === 'captcha' && unmasked.provider && prevObj.provider && unmasked.provider !== prevObj.provider
      ? { provider: unmasked.provider }
      : prevObj;
  const parsed = def.zod.parse({ ...base, ...unmasked });
  const ser = JSON.stringify(parsed);
  if (prev) await db.update('settings', Number((await db.findOne('settings', { key: section }))!.id), { value_json: ser, updated_by: actorId ?? null, updated_at: new Date().toISOString() });
  else await db.insert('settings', { key: section, value_json: ser, updated_by: actorId ?? null, updated_at: new Date().toISOString() });
  await bumpTag('settings');
  cacheSet('settings', `settings:${section}`, parsed, MEM_TTL);
  return parsed as Record<string, unknown>;
}

/** Résolution du préfixe effectif : override admin > catalogue par défaut. */
export async function prefixFor(kind: string, fallbackPrefix: string): Promise<string> {
  const cod = await getCodification();
  return cod.prefixOverrides?.[`${kind}:${fallbackPrefix}`] ?? fallbackPrefix;
}

export function settingsDataDir(): string {
  return paths.data;
}
