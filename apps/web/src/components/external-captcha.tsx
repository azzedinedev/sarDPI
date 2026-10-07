'use client';
/**
 * WIDGET CAPTCHA EXTERNE (hCaptcha / Cloudflare Turnstile / reCAPTCHA v2).
 * ---------------------------------------------------------------------------------------------
 * Pourquoi ce composant : la page de connexion ne savait afficher que le captcha interne. Dès qu'un
 * administrateur sélectionnait hCaptcha dans Paramètres › Captcha, l'écran restait VIDE (aucun
 * widget) alors que le serveur exigeait un jeton : la connexion répondait 400 `auth.captcha` sans
 * que l'utilisateur puisse rien faire.
 *
 * Ici le widget est monté EXPLICITEMENT dans notre conteneur (render=explicit) : on contrôle le
 * cycle de vie — chargement du script, jeton, expiration, erreur — et on peut remettre le défi à
 * zéro après un échec de connexion, exactement comme le bouton « nouvelle question » de l'interne.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import { captchaGlobalName, captchaScriptUrl, type CaptchaProviderName } from '@/lib/captcha-client';

interface WidgetApi {
  render: (el: HTMLElement, options: Record<string, unknown>) => string | number;
  reset?: (id?: string | number) => void;
  remove?: (id?: string | number) => void;
}
type CaptchaWindow = Window & {
  hcaptcha?: WidgetApi;
  turnstile?: WidgetApi;
  grecaptcha?: WidgetApi;
};

/** Scripts déjà insérés : un même fournisseur ne doit pas être téléchargé deux fois (StrictMode, retour sur la page). */
const loadedScripts = new Set<string>();

function loadScriptOnce(src: string): Promise<void> {
  if (loadedScripts.has(src)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.defer = true;
    el.onload = () => {
      loadedScripts.add(src);
      resolve();
    };
    // Réseau coupé, filtre d'entreprise, blocage de domaine : on le signale au lieu de laisser un vide.
    el.onerror = () => reject(new Error('captcha-script'));
    document.head.appendChild(el);
  });
}

/** Le script est chargé quand l'objet global apparaît (il peut être différé après `onload`). */
async function waitForApi(name: string, timeoutMs = 10_000): Promise<WidgetApi> {
  const started = Date.now();
  for (;;) {
    const api = (window as CaptchaWindow)[name as 'hcaptcha'];
    if (api) return api;
    if (Date.now() - started > timeoutMs) throw new Error('captcha-api');
    await new Promise((r) => setTimeout(r, 120));
  }
}

export function ExternalCaptcha({
  provider,
  sitekey,
  lang,
  resetKey,
  onToken,
  onError,
}: {
  provider: CaptchaProviderName;
  sitekey: string;
  lang: string;
  /** Change de valeur ⇒ le défi est remis à zéro (après un échec de connexion par exemple). */
  resetKey: number;
  onToken: (token: string) => void;
  onError: () => void;
}): React.ReactElement {
  const { t } = useT('auth');
  const hostRef = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<string | number | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'blocked'>('loading');
  // Les callbacks sont relus à chaque rendu sans relancer le montage du widget (le script reste chargé).
  const tokenRef = useRef(onToken);
  tokenRef.current = onToken;
  const errorRef = useRef(onError);
  errorRef.current = onError;

  useEffect(() => {
    let cancelled = false;
    const src = captchaScriptUrl(provider, lang);
    const globalName = captchaGlobalName(provider);
    if (!src || !globalName || !sitekey) {
      setState('blocked');
      return;
    }
    setState('loading');
    void (async () => {
      try {
        await loadScriptOnce(src);
        const api = await waitForApi(globalName);
        if (cancelled || !hostRef.current) return;
        hostRef.current.innerHTML = '';
        widgetId.current = api.render(hostRef.current, {
          sitekey,
          theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
          callback: (token: string) => tokenRef.current(token),
          'expired-callback': () => {
            tokenRef.current('');
            errorRef.current();
          },
          'error-callback': () => {
            tokenRef.current('');
            errorRef.current();
          },
        });
        if (!cancelled) setState('ready');
      } catch {
        if (!cancelled) {
          tokenRef.current('');
          setState('blocked');
        }
      }
    })();
    return () => {
      cancelled = true;
      const api = (window as CaptchaWindow)[globalName as 'hcaptcha'];
      if (api?.remove && widgetId.current !== null) {
        try {
          api.remove(widgetId.current);
        } catch {
          /* le fournisseur a déjà nettoyé son iframe : rien à faire */
        }
      }
      widgetId.current = null;
    };
  }, [provider, sitekey, lang]);

  // Remise à zéro demandée par le parent (échec de connexion) : jeton vidé et nouveau défi.
  useEffect(() => {
    if (resetKey === 0) return;
    const globalName = captchaGlobalName(provider);
    const api = globalName ? (window as CaptchaWindow)[globalName as 'hcaptcha'] : undefined;
    if (api?.reset && widgetId.current !== null) {
      try {
        api.reset(widgetId.current);
      } catch {
        /* widget déjà retiré */
      }
    }
    tokenRef.current('');
  }, [resetKey, provider]);

  return (
    <div className="min-w-0">
      <div ref={hostRef} className="min-h-[78px]" data-captcha-provider={provider} />
      {state === 'loading' ? <p className="mt-1 text-[11.5px] font-medium text-[rgb(var(--c-muted))]">{t('captcha.externalWait')}</p> : null}
      {state === 'blocked' ? (
        <p role="alert" className="mt-1 text-[11.5px] font-semibold text-[rgb(var(--c-coral))]">
          {t('captcha.externalBlocked')}
        </p>
      ) : null}
      {state === 'ready' ? <p className="mt-1 text-[11.5px] font-medium text-[rgb(var(--c-muted))]">{t('captcha.externalHint')}</p> : null}
    </div>
  );
}
