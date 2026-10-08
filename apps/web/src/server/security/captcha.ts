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
export type InternalCaptchaMode = 'math' | 'image';

/** Jeu de caractères lisibles sans ambiguïté (exclut 0/O/o, 1/I/l/L). */
const IMAGE_CHARSET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

const store = new LRUCache<string, { answer: number | string; mode: InternalCaptchaMode; exp: number }>({ max: 10_000, ttl: 5 * 60_000 });

/**
 * Génère le défi captcha interne en SVG (100 % local, aucun appel sortant, conforme loi 18-07).
 * Deux modes au choix dans Paramètres › Captcha :
 *  - 'math'  : calcul arithmétique simple (ex. 7 + 4 = 11)
 *  - 'image' : image de 5 caractères déformés avec lignes de bruit et rotations aléatoires.
 */
export function createInternalCaptcha(mode: InternalCaptchaMode = 'math'): { id: string; svg: string; question: string; mode: InternalCaptchaMode } {
  const id = rng(9);
  const jitter = (n: number) => n + Math.random() * 6 - 3;

  if (mode === 'image') {
    let code = '';
    for (let i = 0; i < 5; i++) {
      code += IMAGE_CHARSET[Math.floor(Math.random() * IMAGE_CHARSET.length)];
    }
    store.set(id, { answer: code.toUpperCase(), mode: 'image', exp: Date.now() + 5 * 60_000 });

    const charsSvg = code
      .split('')
      .map((ch, i) => {
        const x = Math.round(14 + i * 26 + (Math.random() * 4 - 2));
        const y = Math.round(31 + (Math.random() * 5 - 2.5));
        const rot = Math.round(Math.random() * 24 - 12);
        const font = i % 2 === 0 ? 'monospace' : "'IBM Plex Sans', sans-serif";
        const color = ['#0c3a45', '#085866', '#0ea5b7', '#155e75'][i % 4];
        return `<text x="${x}" y="${y}" font-family="${font}" font-weight="700" font-size="22" fill="${color}" transform="rotate(${rot} ${x} ${y})">${ch}</text>`;
      })
      .join('');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="48" role="img" aria-label="captcha">
      <defs>
        <linearGradient id="cbg_${id}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#f0f9fa"/>
          <stop offset="100%" stop-color="#e1f1f5"/>
        </linearGradient>
      </defs>
      <rect width="150" height="48" rx="8" fill="url(#cbg_${id})"/>
      <path d="M4 ${22 + Math.random() * 8} Q 50 ${12 + Math.random() * 24} 146 ${20 + Math.random() * 12}" stroke="#0ea5b7" stroke-width="1.4" fill="none" opacity="0.45"/>
      <path d="M6 ${30 + Math.random() * 10} Q 80 ${28 + Math.random() * 14} 144 ${14 + Math.random() * 16}" stroke="#34c77b" stroke-width="1.2" fill="none" opacity="0.4"/>
      ${charsSvg}
      <circle cx="${18 + Math.random() * 30}" cy="${12 + Math.random() * 24}" r="1.8" fill="#f05c4e" opacity=".55"/>
      <circle cx="${70 + Math.random() * 40}" cy="${12 + Math.random() * 24}" r="1.6" fill="#0ea5b7" opacity=".55"/>
      <circle cx="${125 + Math.random() * 18}" cy="${12 + Math.random() * 24}" r="1.8" fill="#34c77b" opacity=".55"/>
    </svg>`;
    // Question = les lettres séparées par un espace (pour la synthèse vocale)
    return { id, svg, question: code.split('').join(' '), mode: 'image' };
  }

  // Mode mathématique
  const a = 2 + Math.floor(Math.random() * 8);
  const b = 1 + Math.floor(Math.random() * 8);
  store.set(id, { answer: a + b, mode: 'math', exp: Date.now() + 5 * 60_000 });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="48" role="img" aria-label="captcha">
    <rect width="150" height="48" rx="8" fill="#eef7f9"/>
    <path d="M4 ${20 + Math.random() * 8} Q 60 ${Math.random() * 40} 146 ${10 + Math.random() * 28}" stroke="#0ea5b7" fill="none" opacity="0.5"/>
    <text x="${jitter(28)}" y="${jitter(32)}" font-family="monospace" font-size="22" fill="#0c3a45" transform="rotate(${Math.random() * 8 - 4} 28 32)">${a} + ${b} = ?</text>
    <circle cx="118" cy="${12 + Math.random() * 24}" r="1.6" fill="#f05c4e" opacity=".6"/>
    <circle cx="132" cy="${12 + Math.random() * 24}" r="1.6" fill="#34c77b" opacity=".6"/>
  </svg>`;
  return { id, svg, question: `${a} + ${b}`, mode: 'math' };
}

export function verifyInternalCaptcha(id: string | undefined, value: string | undefined): boolean {
  if (!id || !value) return false;
  const rec = store.get(id);
  if (!rec) return false;
  store.delete(id); // à usage unique
  const clean = value.trim();
  if (typeof rec.answer === 'string') {
    return clean.toUpperCase() === rec.answer.toUpperCase();
  }
  return Number(clean) === rec.answer;
}

export interface CaptchaResolution {
  /** Ce qui est configuré (Paramètres › Captcha, sinon variable d'environnement). */
  requested: CaptchaProvider;
  /** Fournisseur EFFECTIF : identique à `requested`, ou « internal » en cas de repli. */
  provider: CaptchaProvider;
  /** Mode du captcha interne ('math' = addition simple, 'image' = caractères déformés). */
  mode: InternalCaptchaMode;
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
  // Contournement d'urgence : la variable d'environnement CAPTCHA_OVERRIDE (none | internal)
  // permet à l'administrateur système de débloquer immédiatement l'accès en cas d'erreur de config.
  const override = (process.env.CAPTCHA_OVERRIDE ?? '').trim().toLowerCase() as CaptchaProvider;
  const { getSection } = await import('../settings');
  const cap = (await getSection('captcha', { fresh: true })) as { provider?: CaptchaProvider; mode?: InternalCaptchaMode; sitekey?: string; secret?: string };
  const requested =
    override && (['none', 'internal', 'turnstile', 'hcaptcha', 'recaptcha'] as string[]).includes(override)
      ? override
      : ((cap.provider ?? env.captchaProvider) as CaptchaProvider);
  const mode: InternalCaptchaMode = cap.mode === 'image' ? 'image' : 'math';

  if (!isExternal(requested)) {
    return { requested, provider: requested, mode, sitekey: '', secret: '', configured: true, fallback: false };
  }
  const fromEnv = envKeys(requested);
  const sitekey = (cap.sitekey ?? '').trim() || fromEnv.sitekey.trim();
  const secret = (cap.secret ?? '').trim() || fromEnv.secret.trim();
  // Clé manquante ⇒ le fournisseur ne peut ni afficher de widget ni vérifier de jeton : repli interne.
  if (!sitekey || !secret) {
    return { requested, provider: 'internal', mode, sitekey: '', secret: '', configured: false, fallback: true };
  }
  return { requested, provider: requested, mode, sitekey, secret, configured: true, fallback: false };
}

/** Charge utile PUBLIQUE du captcha — exactement ce dont l'écran de connexion a besoin, rien d'autre. */
export interface CaptchaPublicInfo {
  provider: CaptchaProvider;
  requested: CaptchaProvider;
  mode?: InternalCaptchaMode;
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
    const c = createInternalCaptcha(res.mode);
    return { provider: 'internal', requested: res.requested, configured: res.configured, fallback: res.fallback, sitekey: null, ...c };
  }
  if (res.provider === 'none') {
    return { provider: 'none', requested: res.requested, mode: res.mode, configured: true, fallback: false, sitekey: null };
  }
  return { provider: res.provider, requested: res.requested, mode: res.mode, configured: res.configured, fallback: false, sitekey: res.sitekey };
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
