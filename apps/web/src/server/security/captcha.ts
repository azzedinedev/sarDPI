/**
 * CAPTCHA multi-fournisseurs (désactivé | interne | Turnstile | hCaptcha | reCAPTCHA v2/v3).
 * Le fournisseur « interne » est auto-hébergé (calcul simple + image SVG bruitée) : indispensable pour un
 * déploiement 100 % local conforme loi 18-07 (aucun appel sortant obligatoire).
 * Les fournisseurs externes ne sont activés QUE si l'admin les configure (env ou Paramètres > Captcha).
 *
 * SOURCE UNIQUE DE VÉRITÉ — `resolveCaptcha()` : c'est elle qui décide du fournisseur RÉELLEMENT
 * utilisé, et c'est la même décision que consomment l'écran de connexion (clé publique), la
 * vérification serveur (clé secrète) et l'écran Paramètres. Deux conséquences voulues :
 *
 *  1. Ce que l'utilisateur voit est ce qui est vérifié : aucun cas où l'écran affiche le captcha
 *     interne pendant que le serveur attend un jeton hCaptcha (ou l'inverse).
 *  2. Aucun verrouillage possible : un fournisseur externe choisi SANS clé (sitekey/secret ni en
 *     Paramètres, ni en variable d'environnement) ne peut pas vérifier quoi que ce soit — on
 *     retombe alors sur le captcha INTERNE, avec `configured: false` et `fallback: true` remontés
 *     jusqu'à l'écran. Sans ce repli, choisir « hCaptcha » sans clé rendait la connexion
 *     impossible pour tout le monde (400 auth.captcha), y compris pour l'administrateur.
 */
import { LRUCache } from 'lru-cache';
import { rng } from '../util';
import { env } from '../config';

export type CaptchaProvider = 'none' | 'internal' | 'turnstile' | 'hcaptcha' | 'recaptcha';

const store = new LRUCache<string, { answer: number; exp: number }>({ max: 10_000, ttl: 5 * 60_000 });

export function createInternalCaptcha(): { id: string; svg: string; question: string } {
  const a = 2 + Math.floor(Math.random() * 8);
  const b = 1 + Math.floor(Math.random() * 8);
  const id = rng(9);
  store.set(id, { answer: a + b, exp: Date.now() + 5 * 60_000 });
  const jitter = (n: number) => n + Math.random() * 6 - 3;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="48" role="img" aria-label="captcha">
    <rect width="150" height="48" rx="8" fill="#eef7f9"/>
    <path d="M4 ${20 + Math.random() * 8} Q 60 ${Math.random() * 40} 146 ${10 + Math.random() * 28}" stroke="#0ea5b7" fill="none" opacity="0.5"/>
    <text x="${jitter(28)}" y="${jitter(32)}" font-family="monospace" font-size="22" fill="#0c3a45" transform="rotate(${Math.random() * 8 - 4} 28 32)">${a} + ${b} = ?</text>
    <circle cx="118" cy="${12 + Math.random() * 24}" r="1.6" fill="#f05c4e" opacity=".6"/>
    <circle cx="132" cy="${12 + Math.random() * 24}" r="1.6" fill="#34c77b" opacity=".6"/>
  </svg>`;
  return { id, svg, question: `${a} + ${b}` };
}

export function verifyInternalCaptcha(id: string | undefined, value: string | undefined): boolean {
  if (!id || !value) return false;
  const rec = store.get(id);
  if (!rec) return false;
  store.delete(id); // à usage unique
  return Number(value.trim()) === rec.answer;
}

export interface CaptchaResolution {
  /** Ce qui est configuré (Paramètres › Captcha, sinon variable d'environnement). */
  requested: CaptchaProvider;
  /** Fournisseur EFFECTIF : identique à `requested`, ou « internal » en cas de repli. */
  provider: CaptchaProvider;
  /** Clé publique du fournisseur effectif (utile au rendu du widget) — jamais un secret. */
  sitekey: string;
  /** Clé secrète du fournisseur effectif (vérification serveur) — ne sort JAMAIS de l'API. */
  secret: string;
  /** Le fournisseur demandé est-il utilisable tel quel ? */
  configured: boolean;
  /** Un repli vers le captcha interne a-t-il eu lieu faute de clés ? */
  fallback: boolean;
}

/** Clés d'environnement d'un fournisseur externe (celles utilisées si l'admin n'en a saisi aucune). */
function envKeys(provider: CaptchaProvider): { sitekey: string; secret: string } {
  switch (provider) {
    case 'turnstile':
      return {
        sitekey: process.env.TURNSTILE_SITEKEY ?? env.turnstile.sitekey,
        secret: process.env.TURNSTILE_SECRET ?? env.turnstile.secret,
      };
    case 'hcaptcha':
      return {
        sitekey: process.env.HCAPTCHA_SITEKEY ?? env.hcaptcha.sitekey,
        secret: process.env.HCAPTCHA_SECRET ?? env.hcaptcha.secret,
      };
    case 'recaptcha':
      return {
        sitekey: process.env.RECAPTCHA_SITEKEY ?? env.recaptcha.sitekey,
        secret: process.env.RECAPTCHA_SECRET ?? env.recaptcha.secret,
      };
    default:
      return { sitekey: '', secret: '' };
  }
}

const isExternal = (p: CaptchaProvider): boolean => p === 'turnstile' || p === 'hcaptcha' || p === 'recaptcha';

/**
 * Décision unique « quel captcha protège la connexion, et avec quelles clés ».
 * Priorité des clés : Paramètres › Captcha, puis variables d'environnement (déploiement out-of-the-box).
 */
export async function resolveCaptcha(): Promise<CaptchaResolution> {
  const { getSection } = await import('../settings');
  const cap = (await getSection('captcha')) as { provider?: CaptchaProvider; sitekey?: string; secret?: string };
  const requested = (cap.provider ?? env.captchaProvider) as CaptchaProvider;
  if (!isExternal(requested)) {
    return { requested, provider: requested, sitekey: '', secret: '', configured: true, fallback: false };
  }
  const fromEnv = envKeys(requested);
  const sitekey = (cap.sitekey ?? '').trim() || fromEnv.sitekey.trim();
  const secret = (cap.secret ?? '').trim() || fromEnv.secret.trim();
  // Clé manquante ⇒ le fournisseur ne peut ni afficher de widget ni vérifier de jeton : repli interne.
  if (!sitekey || !secret) {
    return { requested, provider: 'internal', sitekey: '', secret: '', configured: false, fallback: true };
  }
  return { requested, provider: requested, sitekey, secret, configured: true, fallback: false };
}

/** Charge utile PUBLIQUE du captcha — exactement ce dont l'écran de connexion a besoin, rien d'autre. */
export interface CaptchaPublicInfo {
  provider: CaptchaProvider;
  requested: CaptchaProvider;
  configured: boolean;
  fallback: boolean;
  sitekey: string | null;
  id?: string;
  svg?: string;
  question?: string;
}

/**
 * Ce que l'API `/auth/captcha` renvoie : le fournisseur effectif, sa clé PUBLIQUE quand elle existe,
 * et le défi interne (id + SVG + question) uniquement lorsque c'est le mode interne. La clé secrète
 * et les fournisseurs externes non retenus ne figurent jamais dans la réponse.
 */
export async function captchaPublicInfo(): Promise<CaptchaPublicInfo> {
  const res = await resolveCaptcha();
  if (res.provider === 'internal') {
    const c = createInternalCaptcha();
    return { provider: 'internal', requested: res.requested, configured: res.configured, fallback: res.fallback, sitekey: null, ...c };
  }
  if (res.provider === 'none') {
    return { provider: 'none', requested: res.requested, configured: true, fallback: false, sitekey: null };
  }
  return { provider: res.provider, requested: res.requested, configured: res.configured, fallback: false, sitekey: res.sitekey };
}

async function verifyExternal(endpoint: string, secret: string, token: string, remoteIp: string): Promise<boolean> {
  try {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token, remoteip: remoteIp }).toString(),
      signal: AbortSignal.timeout(5000), // circuit breaker : pas de blocage si le service est mort
    });
    if (!r.ok) return false;
    const j = (await r.json()) as { success?: boolean };
    return Boolean(j.success);
  } catch {
    // panne du fournisseur externe : on refuse (sécurité) — mais l'app reste utilisable hors login
    return false;
  }
}

/** Fournisseur effectif (repli compris) — conservé pour les appelants qui n'ont besoin que du nom. */
export async function resolveProvider(): Promise<CaptchaProvider> {
  return (await resolveCaptcha()).provider;
}

export async function verifyCaptcha(req: { turnstileToken?: string; hcaptchaToken?: string; recaptchaToken?: string; captchaId?: string; captchaValue?: string }, ip: string): Promise<boolean> {
  // MÊME résolution que /auth/captcha : si l'écran a affiché le captcha interne (repli), c'est la
  // vérification interne qui s'applique — jamais celle du fournisseur externe resté sans clé.
  const { provider, secret } = await resolveCaptcha();
  switch (provider) {
    case 'none':
      return true;
    case 'turnstile':
      return verifyExternal('https://challenges.cloudflare.com/turnstile/v0/siteverify', secret, req.turnstileToken ?? '', ip);
    case 'hcaptcha':
      return verifyExternal('https://api.hcaptcha.com/siteverify', secret, req.hcaptchaToken ?? '', ip);
    case 'recaptcha':
      return verifyExternal('https://www.google.com/recaptcha/api/siteverify', secret, req.recaptchaToken ?? '', ip);
    case 'internal':
    default:
      return verifyInternalCaptcha(req.captchaId, req.captchaValue);
  }
}

/**
 * Clés publiques configurées par variable d'environnement (les clés saisies dans Paramètres › Captcha
 * sont renvoyées par `captchaPublicInfo`, qui les résout). Sert aux Diagnostics/Documentation.
 */
export function captchaSitekeys(): Record<string, string | undefined> {
  return {
    turnstile: process.env.TURNSTILE_SITEKEY ?? env.turnstile.sitekey,
    hcaptcha: process.env.HCAPTCHA_SITEKEY ?? env.hcaptcha.sitekey,
    recaptcha: process.env.RECAPTCHA_SITEKEY ?? env.recaptcha.sitekey,
  };
}
