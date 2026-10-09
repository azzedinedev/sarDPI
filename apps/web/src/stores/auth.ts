/**
 * Store d'authentification — access token en mémoire, session/rôles/permissions pour l'UI.
 * Le rafraîchissement automatique repose sur le cookie httpOnly (rotation serveur).
 *
 * RÈGLE : aucune vue de l'application ne s'affiche sans session VÉRIFIÉE. Concrètement :
 *   1. au démarrage, `status` vaut 'checking' (écran de vérification, jamais le shell) ;
 *   2. le serveur revalide la session à CHAQUE appel d'API (`sid` révoqué/expiré ⇒ 401
 *      `auth.sessionEnded`) — un jeton encore valable ne suffit donc pas ;
 *   3. toute réponse 401 non récupérable (lib/api → `onAuthLost`) déclenche `sessionLost()` :
 *      l'état est vidé (jeton, identité, rôle, permissions, licence) et le navigateur est renvoyé
 *      vers /login avec la page d'origine en `next`.
 */
'use client';
import { create } from 'zustand';
import { bindApi, rememberCsrf, ApiError } from '@/lib/api';
import { can, type ActionKey } from '@sardpi/shared';
import { loginUrl, redirectTarget } from '@/lib/session-gate';

export interface MeUser {
  id: number;
  username: string;
  email: string;
  fullName: string;
  locale: string;
  theme: string | null;
  density: string | null;
  nav: string | null;
  photoAssetId: number | null;
  totpEnabled: boolean;
}

interface AuthState {
  accessToken: string | null;
  csrf: string | null;
  user: MeUser | null;
  role: { id: number; key: string; name?: Record<string, string> } | null;
  perms: string[];
  license: { state: string; expiresAt?: string } | null;
  /**
   * 'checking' = vérification de session en cours (au démarrage, avant /auth/refresh).
   * Distinct de 'anonymous' : sans cet état, un utilisateur reconnecté avec un cookie de
   * refresh valide était expulsé vers /login le temps que la promesse se résolve.
   */
  status: 'checking' | 'anonymous' | 'authenticating' | 'authed' | 'needs-totp';
  error: string | null;
  totpPending: boolean;
  init: () => Promise<void>;
  /**
   * Session cassée (révocation, expiration, compte désactivé, serveur redémarré) : l'état est vidé
   * ET l'utilisateur renvoyé vers la connexion, sans laisser une seule vue de l'application affichée.
   */
  sessionLost: (reason?: 'expired' | 'ended') => void;
  login: (identifier: string, password: string, extra?: Record<string, string | boolean>) => Promise<void>;
  logout: () => Promise<void>;
  refreshNow: () => Promise<string | null>;
  has: (module: string, action: ActionKey) => boolean;
  setPrefs: (p: Partial<Pick<MeUser, 'locale' | 'theme' | 'density' | 'nav' | 'fullName' | 'photoAssetId'>>) => Promise<void>;
}

let refreshing: Promise<string | null> | null = null;
/**
 * Une seule navigation de sortie à la fois : plusieurs requêtes en vol peuvent constater la même
 * session morte au même instant ; sans ce verrou, chacune appellerait `location.replace`.
 * Le verrou est ré-armé dès qu'une session est de nouveau établie (connexion, `status: 'authed'`),
 * sinon un second échec après reconnexion ne redirigerait plus.
 */
let leaving = false;

/** Amorçage : nombre de reprises sur incident réseau transitoire avant de considérer la session perdue. */
const BOOT_RETRIES = 2;
const BOOT_RETRY_DELAY_MS = 1200;
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** État « aucune session » : tout ce qui vient d'une session précédente est effacé. */
const ANON = { accessToken: null, csrf: null, user: null, role: null, perms: [] as string[], license: null, totpPending: false, status: 'anonymous' as const };

export const useAuth = create<AuthState>((set, get) => ({
  accessToken: null,
  csrf: null,
  user: null,
  role: null,
  perms: [],
  license: null,
  status: 'checking',
  error: null,
  totpPending: false,

  init: async () => {
    bindApi({
      getToken: () => get().accessToken,
      getCsrf: () => get().csrf,
      refresh: () => get().refreshNow(),
      // toute réponse 401 non récupérable (n'importe quelle requête) ⇒ session considérée perdue
      onAuthLost: () => get().sessionLost('ended'),
    });
    await get().refreshNow();
  },

  sessionLost: (reason = 'ended') => {
    /**
     * On efface TOUT : jeton, identité, rôle, permissions, licence. Sans cela, un écran encore monté
     * (ou un composant qui lit `has(...)`) pourrait continuer à s'afficher avec les droits de la
     * session morte — exactement ce que la règle « aucun affichage sans session valide » interdit.
     * Le `error` est conservé : sur /login il porte le message d'échec de connexion en cours.
     */
    set(ANON);
    rememberCsrf(null);
    if (typeof window === 'undefined' || leaving) return;
    const target = redirectTarget(window.location.pathname, window.location.search);
    // déjà sur une page publique (connexion, lien signé…) : rien à rediriger, on reste ici
    if (!target) {
      leaving = false;
      return;
    }
    /**
     * Navigation DURE (`location.replace`) plutôt qu'un `router.replace` : elle purge la mémoire du
     * navigateur — donc les données de santé mises en cache par react-query — et garantit qu'aucun
     * composant de l'ancienne session ne peut se re-rendre. L'écran de connexion explique la
     * redirection (`reason`) et `next` ramène l'utilisateur à sa page après reconnexion.
     */
    leaving = true;
    setTimeout(() => { leaving = false; }, 2000);
    const url = new URL(target, window.location.origin);
    if (reason) url.searchParams.set('reason', reason);
    window.location.replace(url.toString());
  },

  refreshNow: async () => {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const r = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' });
        if (!r.ok) {
          // pas/plus de session valide : cookie absent, expiré, révoqué, ou compte fermé
          get().sessionLost('ended');
          return null;
        }
        const j = (await r.json()) as { accessToken: string; csrfToken?: string };
        set({ accessToken: j.accessToken, csrf: j.csrfToken ?? null, status: 'authenticating' });
        rememberCsrf(j.csrfToken ?? null);
        const meRes = await fetch('/api/v1/auth/me', { headers: { authorization: `Bearer ${j.accessToken}` }, credentials: 'include' });
        if (!meRes.ok) {
          // jeton obtenu mais identité refusée : session incohérente/incomplète → on repart de zéro
          get().sessionLost('ended');
          return null;
        }
        const me = (await meRes.json()) as {
          user: MeUser;
          role: { id: number; key: string; name: Record<string, string> };
          perms: string[];
          license: { state: string };
        };
        set({ user: me.user, role: me.role, perms: me.perms, license: me.license, status: 'authed', error: null });
        if (typeof document !== 'undefined') {
          document.documentElement.lang = me.user?.locale ?? 'fr';
          document.documentElement.dir = me.user?.locale === 'ar' ? 'rtl' : 'ltr';
        }
        return j.accessToken;
      } catch {
        /**
         * Le serveur n'a pas répondu (coupure réseau, redémarrage en cours). L'état de la session est
         * INCONNU : on ne l'efface pas sur un simple hoquet — on retente brièvement en gardant
         * l'écran de vérification (donc rien de l'application n'est affiché), et si la vérification
         * reste impossible, on renvoie vers la connexion plutôt que d'ouvrir une application dont on
         * ne peut pas prouver qu'elle est autorisée.
         */
        set({ status: 'checking' });
        for (let i = 0; i < BOOT_RETRIES; i++) {
          await wait(BOOT_RETRY_DELAY_MS);
          const fresh = await get().refreshNow();
          if (fresh) return fresh;
          if (get().status === 'anonymous') return null; // la reprise a tranché : session réellement morte
        }
        get().sessionLost('expired');
        return null;
      } finally {
        setTimeout(() => (refreshing = null), 0);
      }
    })();
    return refreshing;
  },

  login: async (identifier, password, extra) => {
    set({ status: 'authenticating', error: null });
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ identifier, password, ...extra }),
      });
      const j = await res.json();
      if (!res.ok) {
        const code = (j as { error?: { code?: string } }).error?.code ?? 'auth.invalid';
        if (code === 'auth.ok-totp' || (j as { totpRequired?: boolean }).totpRequired) {
          set({ status: 'needs-totp', totpPending: true, error: null });
          return;
        }
        set({ status: 'anonymous', error: code });
        throw new ApiError(res.status, code);
      }
      if ((j as { totpRequired?: boolean }).totpRequired) {
        set({ status: 'needs-totp', totpPending: true });
        return;
      }
      set({ accessToken: j.accessToken, csrf: j.csrfToken, status: 'authed' });
      rememberCsrf(j.csrfToken);
      leaving = false; // nouvelle session : une prochaine perte devra rediriger de nouveau
      await get().refreshNow();
    } catch (e) {
      // échec de connexion (mauvais identifiants, captcha…) : on reste sur l'écran, aucune redirection
      if (get().status !== 'anonymous') set({ status: 'anonymous' });
      throw e;
    }
  },

  logout: async () => {
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
    } finally {
      set(ANON);
      rememberCsrf(null);
      // navigation dure : aucune donnée de la session précédente ne doit rester en mémoire
      window.location.replace(loginUrl());
    }
  },

  has: (module, action) => can(get().perms, module, action),

  setPrefs: async (p) => {
    set((s) => (s.user ? { user: { ...s.user, ...p } } : {}));
    await api_patch('/auth/me', p);
  },
}));

async function api_patch(path: string, body: unknown): Promise<void> {
  await fetch(`/api/v1${path}`, { method: 'PATCH', headers: { 'content-type': 'application/json', ...(useAuth.getState().accessToken ? { authorization: `Bearer ${useAuth.getState().accessToken as string}` } : {}) }, credentials: 'include', body: JSON.stringify(body) });
}

/**
 * Ré-armement du verrou de redirection : toute nouvelle session authentifiée doit pouvoir être
 * suivie d'une nouvelle sortie de secours (déconnexion → reconnexion → session à nouveau cassée).
 */
useAuth.subscribe((state, prev) => {
  if (state.status === 'authed' && prev.status !== 'authed') leaving = false;
});

export { ApiError };
