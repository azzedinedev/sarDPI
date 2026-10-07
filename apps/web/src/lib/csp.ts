/**
 * CSP centralisée — construite PAR REQUÊTE dans le middleware, avec UN NONCE frais à chaque réponse.
 * ---------------------------------------------------------------------------
 * Pourquoi pas next.config headers() ? Les en-têtes statiques ne peuvent pas porter de nonce :
 * le App Router émet des scripts inline (streaming RSC « __next_f.push », bootstrap du hydratant).
 * Sans nonce, le navigateur les BLOQUE (script-src sans 'unsafe-inline') → page rendue mais morte.
 * Le middleware transmet le nonce à Next via « x-nextjs-csp-nonce » : Next l'ajoute LUI-MÊME à tous
 * ses scripts/links inline/externes — rien à changer dans les composants.
 *
 * DEV : HMR exige 'unsafe-eval' + 'unsafe-inline' + websockets ; ces relâchements n'existent
 * JAMAIS en production (build « strict » : nonce + 'strict-dynamic', providers captcha autorisés).
 */

export interface CspInput {
  nonce: string;
  dev: boolean;
}

/** Origines captcha externes (alignées sur CAPTCHA_PROVIDER — hors prod sans provider, harmless). */
const CAPTCHA_ORIGINS = 'https://challenges.cloudflare.com https://*.hcaptcha.com https://api.hcaptcha.com https://www.google.com https://recaptcha.net';

export function buildCsp({ nonce, dev }: CspInput): string {
  const scriptSrc = dev
    ? `'self' 'unsafe-eval' 'unsafe-inline' ${CAPTCHA_ORIGINS}`
    : // 'strict-dynamic' : les scripts légitimes chargés DYNAMIQUEMENT par un script à nonce héritent
      // de la confiance — inutile d'énumérer des origines https: dans ce cas.
      `'self' 'unsafe-eval' 'nonce-${nonce}' 'strict-dynamic' ${CAPTCHA_ORIGINS}`;
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Radix/tippy/notif. + <style> des thèmes admin → inline styles assumés (pas de données utilisateurs).
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https://*.hcaptcha.com https://challenges.cloudflare.com https://www.google.com`,
    "font-src 'self'",
    // API + fetch i18n sur l'origine ; widgets captcha externes (hCaptcha/Turnstile/reCAPTCHA) ; dev : websocket HMR (ws:).
    `connect-src 'self' blob: ${CAPTCHA_ORIGINS}${dev ? ' ws: wss:' : ''}`,
    // Aperçu PDF via blob: worker (aperçuOrdonnance) — objectSrc reste fermé.
    "worker-src 'self' blob:",
    "frame-src 'self' https://challenges.cloudflare.com https://*.hcaptcha.com https://www.google.com https://recaptcha.net https://*.recaptcha.net",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ]
    .map((x) => x.trim())
    .join('; ');
}
