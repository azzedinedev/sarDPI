/**
 * Validation Zod des manifestes externes : langues (languages.json), thèmes (theme.json),
 * profils pays (country-profiles/*.json). Un fichier invalide est REFUSÉ sans impacter l'app.
 */
import { z } from 'zod';

export const languagesManifestZ = z.object({
  default: z.string().min(2).max(5),
  fallback: z.string().min(2).max(5),
  namespaces: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,20}$/)).min(1),
  languages: z
    .array(
      z.object({
        code: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
        name: z.string().min(1),
        nameEn: z.string().optional(),
        dir: z.enum(['ltr', 'rtl']),
        font: z.string().min(3),
        locale: z.string().min(2),
        htmlLang: z.string().optional(),
        numberingSystem: z.enum(['latn', 'arab']).default('latn'),
      }),
    )
    .min(1),
});
export type LanguagesManifest = z.infer<typeof languagesManifestZ>;
export type LangDef = LanguagesManifest['languages'][number];

const colorVar = z.string().regex(/^\d{1,3} \d{1,3} \d{1,3}( \/ [\d.]+)?$/);
export const themeManifestZ = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,40}$/),
  displayName: z.record(z.string()),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  author: z.string().max(80).optional(),
  modes: z.array(z.enum(['light', 'dark'])).min(1).default(['light']),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  variables: z.record(z.enum(['light', 'dark']), z.record(z.string().startsWith('--'), colorVar)).optional(),
  js: z.enum(['none', 'scripts.js']).default('none'),
  approved: z.boolean().default(false),
  sha256: z.string().optional(),
});
export type ThemeManifest = z.infer<typeof themeManifestZ>;

export const countryProfileZ = z
  .object({
    code: z.string().regex(/^[A-Z]{2}$/),
    enabled: z.boolean().default(false),
    name: z.record(z.string()),
    currency: z.object({ code: z.string().length(3), symbol: z.string(), symbolAfter: z.boolean().default(false), decimals: z.number().int().min(0).max(4).default(2), intl: z.string().optional() }),
    timezone: z.string().min(3),
    dialCode: z.string().regex(/^\+\d{1,4}$/),
    phone: z.object({ pattern: z.string(), patternHint: z.record(z.string()).optional() }),
    dates: z
      .object({
        firstDayOfWeek: z.number().int().min(0).max(6).default(1),
        weekendDays: z.array(z.number().int().min(0).max(6)).default([0, 6]),
        gregorianFormat: z.string().default('dd/MM/yyyy'),
        hijri: z.object({ enabledByDefault: z.boolean().default(false), calendar: z.string().optional(), locale: z.string().optional() }).optional(),
        numberingSystem: z.enum(['latn', 'arab']).optional(),
      })
      .default({ firstDayOfWeek: 1, weekendDays: [0, 6] }),
    address: z.record(z.unknown()).optional(),
    identifiers: z.record(z.unknown()).optional(),
    documents: z.record(z.unknown()).optional(),
    medication: z.record(z.unknown()).optional(),
    vaccination: z.record(z.unknown()).optional(),
    legal: z.record(z.unknown()).optional(),
  })
  .passthrough();
export type CountryProfile = z.infer<typeof countryProfileZ>;
