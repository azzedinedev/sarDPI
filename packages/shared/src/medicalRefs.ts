/**
 * RÉFÉRENTIELS MÉDICAUX CONFIGURABLES — groupes sanguins & caisses de sécurité sociale (SS funds).
 * §6/§7 : tout est administrable SANS CODE (Réglages › Référentiels médicaux) ; les listes
 * « par défaut » servent d'amorçage (factory settings) et l'admin ajoute/retire/traduit.
 * Les libellés sont multilingues (MultiLabel) ⇒ affichés traduits selon la langue active.
 */
import { z } from 'zod';
import type { MultiLabel } from './labels';

export interface RefItem {
  code: string; // ex. « A+ », « CNAS » — stocké tel quel en base (immutable en usage)
  label: MultiLabel; // libellé affiché, traduit selon la langue active
  active?: boolean; // défaut true
}

const refItemZ = z.object({
  code: z.string().regex(/^[A-Za-z0-9+±-]{1,14}$/),
  label: z.record(z.string().max(120)).refine((v) => Object.values(v).some((s) => s?.trim()), 'label requis'),
  active: z.boolean().default(true),
});

export const medicalRefsZ = z.object({
  bloodGroups: z.array(refItemZ).min(1),
  ssFunds: z.array(refItemZ).min(1),
});
export type MedicalRefsConfig = z.infer<typeof medicalRefsZ>;

/** Amorçage — groupes sanguins (libellés courts traduits ; le code ABO/Rhésus reste universel). */
export const DEFAULT_BLOOD_GROUPS: RefItem[] = [
  { code: 'O-', label: { fr: 'O Rhésus négatif', ar: 'O عامل ريسس سالب', es: 'O Rh negativo', en: 'O Rh-negative' }, active: true },
  { code: 'O+', label: { fr: 'O Rhésus positif', ar: 'O عامل ريسس موجب', es: 'O Rh positivo', en: 'O Rh-positive' }, active: true },
  { code: 'A-', label: { fr: 'A Rhésus négatif', ar: 'A عامل ريسس سالب', es: 'A Rh negativo', en: 'A Rh-negative' }, active: true },
  { code: 'A+', label: { fr: 'A Rhésus positif', ar: 'A عامل ريسس موجب', es: 'A Rh positivo', en: 'A Rh-positive' }, active: true },
  { code: 'B-', label: { fr: 'B Rhésus négatif', ar: 'B عامل ريسس سالب', es: 'B Rh negativo', en: 'B Rh-negative' }, active: true },
  { code: 'B+', label: { fr: 'B Rhésus positif', ar: 'B عامل ريسس موجب', es: 'B Rh positivo', en: 'B Rh-positive' }, active: true },
  { code: 'AB-', label: { fr: 'AB Rhésus négatif', ar: 'AB عامل ريسس سالب', es: 'AB Rh negativo', en: 'AB Rh-negative' }, active: true },
  { code: 'AB+', label: { fr: 'AB Rhésus positif', ar: 'AB عامل ريسس موجب', es: 'AB Rh positivo', en: 'AB Rh-positive' }, active: true },
];

/** Amorçage — caisses de sécurité sociale (Algérie + usuelles). */
export const DEFAULT_SS_FUNDS: RefItem[] = [
  { code: 'CNAS', label: { fr: 'CNAS — salariés', ar: 'الصندوق الوطني للضمان الاجتماعي للعمال الأجراء', es: 'CNAS — asalariados', en: 'CNAS — employees' }, active: true },
  { code: 'CASNOS', label: { fr: 'CASNOS — non-salariés', ar: 'الصندوق الوطني للضمان الاجتماعي لغير الأجراء', es: 'CASNOS — autónomos', en: 'CASNOS — self-employed' }, active: true },
  { code: 'CNMA', label: { fr: 'CNMA — agriculteurs', ar: 'الصندوق الوطني للضمان الاجتماعي لغير الأجراء الفلاحيين', es: 'CNMA — agricultores', en: 'CNMA — farmers' }, active: true },
];

/* ------------------------------------------------------------------ éditeur HTML léger : assainissement */

const RICH_ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'BR', 'P', 'DIV', 'SPAN']);

/**
 * Assainit un fragment HTML issu du éditeur riche (allergies, antécédents, notes) :
 * whitelist de balises simples, aucun attribut, `on*`/`script`/`style` supprimés.
 * Le résultat reste du HTML « sûr » stocké tel quel et rendu via dangerouslySetInnerHTML côté client (re-sanitize défensif à l'affichage).
 */
export function sanitizeRichHtml(input: string): string {
  let s = String(input ?? '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<\s*(script|style|iframe|object|embed|link|meta|form|input|textarea|svg|math)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  s = s.replace(/<\s*(script|style|iframe|object|embed|link|meta|form|input|textarea|svg|math)[^>]*\/?\s*>/gi, '');
  // retire tous les attributs (y compris event handlers & href javascript:) ; garde uniquement la structure
  s = s.replace(/<\s*([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z-:]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g, (_m, tag: string, attrs: string, selfClose: string) => {
    const t = String(tag).toUpperCase();
    if (!RICH_ALLOWED.has(t)) return '';
    return t === 'BR' ? '<br>' : `<${t.toLowerCase()}>`;
  });
  s = s.replace(/<\s*\/\s*([a-zA-Z][a-zA-Z0-9]*)\s*>/g, (_m, tag: string) => (RICH_ALLOWED.has(String(tag).toUpperCase()) ? `</${String(tag).toLowerCase()}>` : ''));
  // neutralise les protocoles restants dans du texte nu (défensif)
  s = s.replace(/javascript:/gi, '');
  return s.trim();
}

/** HTML → texte brut (pour PDF, contrôles d'interactions, exports CSV). */
export function htmlToPlain(html: string): string {
  return String(html ?? '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Liste de chaînes (legacy CSV/array) → fragment HTML propre (rend lisible dans l'éditeur riche). */
export function richListFromLines(lines: string[]): string {
  const clean = lines.map((x) => String(x ?? '').trim()).filter(Boolean);
  if (!clean.length) return '';
  return `<ul>${clean.map((x) => `<li>${sanitizeRichHtml(x)}</li>`).join('')}</ul>`;
}

/**
 * Extrait les « jetons » d'un champ allergies/antécédents quel que soit le format stocké :
 * array legacy de strings, ou HTML riche → texte → découpage par lignes/points-virgules.
 * Utilisé par le contrôle allergies↔médicaments (jamais bloquant).
 */
export function allergyTokens(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim().toLowerCase()).filter(Boolean);
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return [];
    const text = s.includes('<') ? htmlToPlain(s) : s;
    return text
      .split(/[\n;•·]+|,\s+/)
      .map((x) => x.trim().toLowerCase())
      .filter((x) => x.length >= 2)
      .slice(0, 60);
  }
  return [];
}
