/**
 * Client API — access token en MÉMOIRE uniquement (jamais localStorage : l'accès persistant passe par le
 * cookie httpOnly du refresh, rotatif). Sur 401 : un seul essai de /auth/refresh puis retry.
 * Les erreurs remontent avec le code i18n du serveur (« errors.* », « auth.* ») pour affichage traduit.
 */
'use client';

export interface ApiErrorEnvelope {
  error?: { code?: string; message?: string; details?: Record<string, string> | null; rid?: string };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
    public details?: Record<string, string> | null,
    public rid?: string,
  ) {
    super(message ?? code);
  }
}

type TokenGetter = () => string | null;
type Refresher = () => Promise<string | null>;
type CsrfGetter = () => string | null;

let getToken: TokenGetter = () => null;
let refresh: Refresher = async () => null;
let getCsrf: CsrfGetter = () => null;
/** Jeton CSRF mémorisé en mémoire (réponse login/refresh ou /auth/csrf) — fallback si le store n'a rien. */
let csrfMemory: string | null = null;
export function rememberCsrf(token: string | null): void { csrfMemory = token; }
export async function refreshCsrf(): Promise<void> {
  const res = await fetch('/api/v1/auth/csrf', { credentials: 'include', cache: 'no-store' });
  if (!res.ok) return;
  const j = (await res.json().catch(() => null)) as { csrfToken?: string } | null;
  csrfMemory = j?.csrfToken ?? csrfMemory;
}

export function bindApi(hooks: { getToken: TokenGetter; refresh: Refresher; getCsrf: CsrfGetter }): void {
  getToken = hooks.getToken;
  refresh = hooks.refresh;
  getCsrf = hooks.getCsrf;
}

async function doFetch(path: string, init: RequestInit, retried = false): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const method = (init.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    const csrf = getCsrf() ?? csrfMemory;
    if (csrf) headers.set('x-csrf-token', csrf);
    if (!(init.body instanceof FormData) && init.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
  }
  const res = await fetch(`/api/v1${path}`, { ...init, headers, credentials: 'include', cache: 'no-store' });
  if (res.status === 403 && !retried && method !== 'GET' && method !== 'HEAD') {
    // Jeton absent/périmé (nouvel onglet, cookie expiré…) : on ré-amorce le double-submit puis on rejoue une fois.
    const j = (await res.clone().json().catch(() => null)) as { error?: { code?: string } } | null;
    if (j?.error?.code === 'errors.csrf') {
      await refreshCsrf();
      return doFetch(path, init, retried);
    }
  }
  if (res.status === 401 && !retried) {
    const fresh = await refresh();
    if (fresh) return doFetch(path, init, true);
  }
  return res;
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-json (print html etc.) */
  }
  if (!res.ok) {
    const env = (json as ApiErrorEnvelope | null)?.error;
    throw new ApiError(res.status, env?.code ?? (res.status === 401 ? 'errors.unauthorized' : 'errors.server'), env?.message, env?.details ?? null, env?.rid);
  }
  if (res.headers.get('content-type')?.includes('text/html')) return text as T;
  if (res.headers.get('content-type')?.includes('csv') || res.headers.get('content-type')?.includes('octet-stream')) return text as T;
  return (json ?? {}) as T;
}

/**
 * Sérialise des conditions au format « filters » attendu par le CRUD serveur.
 * IMPORTANT : les query params libres (?active=true&typePrefix=MED…) sont IGNORES par
 * buildQuery() — seuls `q`, `scope`, `page/pageSize`, `sortBy/sortDir` et `filters` sont lus.
 * Passer par ce helper évite de croire à tort qu'un filtre est appliqué.
 */
export function crudFilters(
  items: { field: string; op?: 'contains' | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'empty' | 'notEmpty' | 'in'; value?: string | number | boolean; value2?: string | number }[],
  combinator: 'AND' | 'OR' = 'AND',
): string {
  return JSON.stringify({ combinator, items: items.map((i) => ({ field: i.field, op: i.op ?? 'eq', ...(i.value !== undefined ? { value: i.value } : {}), ...(i.value2 !== undefined ? { value2: i.value2 } : {}) })) });
}

export const api = {
  async get<T>(path: string, query?: Record<string, string | number | undefined | null>): Promise<T> {
    const qs = query ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]))}` : '';
    return (await parse<T>(await doFetch(path + qs, { method: 'GET' })));
  },
  async post<T>(path: string, body?: unknown): Promise<T> {
    return parse<T>(await doFetch(path, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body ?? {}) }));
  },
  async put<T>(path: string, body?: unknown): Promise<T> {
    return parse<T>(await doFetch(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }));
  },
  async patch<T>(path: string, body?: unknown): Promise<T> {
    return parse<T>(await doFetch(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }));
  },
  async del<T>(path: string): Promise<T> {
    return parse<T>(await doFetch(path, { method: 'DELETE' }));
  },
  async upload<T>(path: string, form: FormData): Promise<T> {
    return parse<T>(await doFetch(path, { method: 'POST', body: form }));
  },
  /** Téléchargement avec en-tête d'auth (blob) — exports, PDF, etc. */
  async download(path: string, filename: string): Promise<void> {
    const res = await doFetch(path, { method: 'GET' });
    if (!res.ok) throw new ApiError(res.status, 'errors.network');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  },
};
