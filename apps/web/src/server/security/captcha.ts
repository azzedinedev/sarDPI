/**
 * CAPTCHA multi-fournisseurs (désactivé | interne | Turnstile | hCaptcha | reCAPTCHA v2/v3).
 * Le fournisseur « interne » est auto-hébergé (calcul simple + image SVG bruitée) : indispensable pour un
 * déploiement 100 % local conforme loi 18-07 (aucun appel sortant obligatoire).
 * Les fournisseurs externes ne sont activés QUE si l'admin les configure (env ou Paramètres > Captcha).
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

export async function resolveProvider(): Promise<CaptchaProvider> {
  const { getSection } = await import('../settings');
  const cap = (await getSection('captcha')) as { provider?: CaptchaProvider };
  return cap.provider ?? env.captchaProvider;
}

export async function verifyCaptcha(req: { turnstileToken?: string; hcaptchaToken?: string; recaptchaToken?: string; captchaId?: string; captchaValue?: string }, ip: string): Promise<boolean> {
  const provider = await resolveProvider();
  switch (provider) {
    case 'none':
      return true;
    case 'turnstile':
      return verifyExternal('https://challenges.cloudflare.com/turnstile/v0/siteverify', env.turnstile.secret, req.turnstileToken ?? '', ip);
    case 'hcaptcha':
      return verifyExternal('https://api.hcaptcha.com/siteverify', env.hcaptcha.secret, req.hcaptchaToken ?? '', ip);
    case 'recaptcha':
      return verifyExternal('https://www.google.com/recaptcha/api/siteverify', env.recaptcha.secret, req.recaptchaToken ?? '', ip);
    case 'internal':
    default:
      return verifyInternalCaptcha(req.captchaId, req.captchaValue);
  }
}

export function captchaSitekeys(): Record<string, string | undefined> {
  return {
    turnstile: env.turnstile.sitekey,
    hcaptcha: env.hcaptcha.sitekey,
    recaptcha: env.recaptcha.sitekey,
  };
}
