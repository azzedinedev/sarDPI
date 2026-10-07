/**
 * CAPTCHA côté navigateur — tout ce qui peut être décidé SANS DOM, isolé ici pour être testable.
 * ---------------------------------------------------------------------------------------------
 * L'écran de connexion ne doit pas « savoir » quel fournisseur est actif : il demande
 * `/auth/captcha`, qui renvoie le fournisseur EFFECTIF (repli interne compris) et sa clé publique.
 * Ces helpers traduisent cette réponse en : script à charger, variable globale du widget, champ de
 * jeton à envoyer au serveur, et charge utile de connexion.
 */

export type CaptchaProviderName = 'none' | 'internal' | 'turnstile' | 'hcaptcha' | 'recaptcha';

/** Réponse de `GET /api/v1/auth/captcha` (voir `captchaPublicInfo` côté serveur). */
export interface CaptchaInfo {
  provider: CaptchaProviderName;
  /** Fournisseur choisi dans Paramètres › Captcha (peut différer : voir `fallback`). */
  requested?: CaptchaProviderName;
  /** Le fournisseur demandé est-il utilisable tel quel ? */
  configured?: boolean;
  /** Repli sur le captcha interne faute de clés côté serveur. */
  fallback?: boolean;
  /** Clé PUBLIQUE du fournisseur externe (widget) — absente en mode interne/aucun. */
  sitekey?: string | null;
  id?: string | null;
  svg?: string | null;
  question?: string | null;
}

/** Champ de jeton attendu par le serveur pour ce fournisseur (`loginZ`). */
export function captchaTokenField(provider: CaptchaProviderName): 'turnstileToken' | 'hcaptchaToken' | 'recaptchaToken' | null {
  switch (provider) {
    case 'turnstile':
      return 'turnstileToken';
    case 'hcaptcha':
      return 'hcaptchaToken';
    case 'recaptcha':
      return 'recaptchaToken';
    default:
      return null;
  }
}

/** Variable globale exposée par le script du fournisseur (pour monter le widget explicitement). */
export function captchaGlobalName(provider: CaptchaProviderName): 'hcaptcha' | 'turnstile' | 'grecaptcha' | null {
  switch (provider) {
    case 'hcaptcha':
      return 'hcaptcha';
    case 'turnstile':
      return 'turnstile';
    case 'recaptcha':
      return 'grecaptcha';
    default:
      return null;
  }
}

/**
 * URL du script du widget — rendu EXPLICITE (aucun widget automatique surprise, on monte nous-mêmes
 * dans notre conteneur) et langue alignée sur l'interface.
 */
export function captchaScriptUrl(provider: CaptchaProviderName, lang: string): string | null {
  const hl = lang === 'ar' ? 'ar' : lang === 'es' ? 'es' : lang === 'en' ? 'en' : 'fr';
  switch (provider) {
    case 'hcaptcha':
      return `https://js.hcaptcha.com/1/api.js?render=explicit&hl=${hl}`;
    case 'turnstile':
      return 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    case 'recaptcha':
      return `https://www.google.com/recaptcha/api.js?render=explicit&hl=${hl}`;
    default:
      return null;
  }
}

/** Un jeton de widget est-il indispensable pour soumettre ? (aucun : interne/aucun) */
export function captchaNeedsToken(provider: CaptchaProviderName): boolean {
  return captchaTokenField(provider) !== null;
}

/**
 * Charge utile transmise à `POST /auth/login` : le serveur reçoit EXACTEMENT le champ attendu par le
 * fournisseur effectif, plus le défi interne quand c'est lui qui protège la connexion.
 */
export function captchaPayload(info: CaptchaInfo | null, input: { token?: string; id?: string | null; value?: string }): Record<string, string> {
  if (!info) return {};
  if (info.provider === 'internal') {
    const id = input.id ?? info.id;
    return id ? { captchaId: id, captchaValue: input.value ?? '' } : {};
  }
  const field = captchaTokenField(info.provider);
  return field && input.token ? { [field]: input.token } : {};
}
