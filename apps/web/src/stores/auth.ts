/**
 * Store d'authentification — access token en mémoire, session/rôles/permissions pour l'UI.
 * Le rafraîchissement automatique repose sur le cookie httpOnly (rotation serveur).
 */
'use client';
import { create } from 'zustand';
import { bindApi, rememberCsrf, ApiError } from '@/lib/api';
import { can, type ActionKey } from '@sardpi/shared';

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
  login: (identifier: string, password: string, extra?: Record<string, string | boolean>) => Promise<void>;
  logout: () => Promise<void>;
  refreshNow: () => Promise<string | null>;
  has: (module: string, action: ActionKey) => boolean;
  setPrefs: (p: Partial<Pick<MeUser, 'locale' | 'theme' | 'density' | 'nav' | 'fullName' | 'photoAssetId'>>) => Promise<void>;
}

let refreshing: Promise<string | null> | null = null;

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
    });
    await get().refreshNow();
  },

  refreshNow: async () => {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const r = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' });
        if (!r.ok) {
          set({ status: 'anonymous', accessToken: null, user: null, perms: [] });
          return null;
        }
        const j = (await r.json()) as { accessToken: string; csrfToken?: string };
        set({ accessToken: j.accessToken, csrf: j.csrfToken ?? null, status: 'authenticating' });
        rememberCsrf(j.csrfToken ?? null);
        const meRes = await fetch('/api/v1/auth/me', { headers: { authorization: `Bearer ${j.accessToken}` }, credentials: 'include' });
        if (!meRes.ok) {
          set({ status: 'anonymous', accessToken: null });
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
        set({ status: 'anonymous' });
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
      await get().refreshNow();
    } catch (e) {
      set({ status: 'anonymous' });
      throw e;
    }
  },

  logout: async () => {
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
    } finally {
      set({ accessToken: null, user: null, perms: [], status: 'anonymous', totpPending: false });
      rememberCsrf(null);
      window.location.href = '/login';
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

export { ApiError };
