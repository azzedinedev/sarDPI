// @vitest-environment happy-dom
/**
 * SESSION INTERROMPUE — comportement CLIENT (aucun affichage sans session valide).
 * -------------------------------------------------------------------------------------------
 * Deux mécanismes complémentaires sont vérifiés ici :
 *   1. `lib/api` : un 401 est d'abord rattrapé par un rafraîchissement (cas normal d'un jeton
 *      expiré) ; si le rafraîchissement échoue — ou si le jeton fraîchement obtenu est DÉJÀ refusé —
 *      la perte de session est signalée une seule fois, sans boucle d'essais ;
 *   2. `stores/auth` : `sessionLost()` vide jeton, identité, rôle, permissions et licence (pour
 *      qu'aucun écran ne puisse se rendrer avec les droits d'une session morte) puis renvoie vers
 *      /login en conservant la page d'origine, sans jamais rediriger depuis une page publique.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const replaceSpy = vi.fn();

/** Remplace `window.location` par une doublure : les tests observent la navigation, sans la subir. */
function fakeLocation(pathname: string, search = ''): void {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { pathname, search, origin: 'https://app.test', href: `https://app.test${pathname}${search}`, replace: replaceSpy, assign: replaceSpy },
  });
}

/** Réponse minimale exploitable par le client API. */
function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const { api, bindApi } = await import('../apps/web/src/lib/api');
const { useAuth } = await import('../apps/web/src/stores/auth');

beforeEach(() => {
  replaceSpy.mockReset();
  // page publique par défaut : aucune navigation n'est attendue tant que le test ne l'exige pas.
  // Le statut « authed » ré-arme le verrou de redirection du store (équivalent d'une nouvelle session).
  fakeLocation('/login');
  useAuth.setState({ accessToken: 'tok', csrf: 'csrf', user: null, role: null, perms: [], license: null, status: 'authed' });
});

afterEach(() => {
  vi.restoreAllMocks();
  useAuth.setState({ accessToken: null, csrf: null, user: null, role: null, perms: [], license: null, status: 'checking', error: null, totpPending: false });
});

describe('lib/api — 401 : rafraîchir une fois, sinon signaler la perte de session', () => {
  it('jeton d’accès expiré (cas normal) : rafraîchissement puis reprise, AUCUNE perte de session', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'errors.unauthorized' } }))
      .mockResolvedValueOnce(jsonResponse(200, { rows: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const onAuthLost = vi.fn();
    bindApi({ getToken: () => 'stale', getCsrf: () => null, refresh: async () => 'fresh', onAuthLost });

    await expect(api.get<{ rows: unknown[] }>('/patients')).resolves.toEqual({ rows: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onAuthLost).not.toHaveBeenCalled();
  });

  it('rafraîchissement impossible (cookie disparu, session révoquée) : perte signalée une seule fois', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: 'auth.sessionEnded' } }));
    vi.stubGlobal('fetch', fetchMock);
    const onAuthLost = vi.fn();
    bindApi({ getToken: () => 'dead', getCsrf: () => null, refresh: async () => null, onAuthLost });

    await expect(api.get('/patients')).rejects.toMatchObject({ status: 401, code: 'auth.sessionEnded' });
    expect(onAuthLost).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1); // aucun acharnement : une seule tentative
  });

  it('session révoquée PENDANT l’appel : le jeton frais est refusé → perte signalée', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: 'auth.sessionEnded' } }));
    vi.stubGlobal('fetch', fetchMock);
    const onAuthLost = vi.fn();
    bindApi({ getToken: () => 'stale', getCsrf: () => null, refresh: async () => 'fresh', onAuthLost });

    await expect(api.get('/patients')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 essai + 1 reprise
    expect(onAuthLost).toHaveBeenCalledTimes(1);
  });

  it('un 403 (permission refusée) n’est PAS une session perdue', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(403, { error: { code: 'errors.forbidden' } })));
    const onAuthLost = vi.fn();
    bindApi({ getToken: () => 'ok', getCsrf: () => null, refresh: async () => 'fresh', onAuthLost });
    await expect(api.get('/admin/users')).rejects.toMatchObject({ status: 403 });
    expect(onAuthLost).not.toHaveBeenCalled();
  });
});

describe('stores/auth — sessionLost() vide l’état et renvoie vers la connexion', () => {
  it('efface jeton, identité, rôle, permissions et licence (aucune vue ne peut survivre)', () => {
    useAuth.setState({
      user: { id: 1, username: 'admin', email: 'a@b', fullName: 'A', locale: 'fr', theme: null, density: null, nav: null, photoAssetId: null, totpEnabled: false },
      role: { id: 1, key: 'admin' },
      perms: ['patients:view'],
      license: { state: 'valid' },
    });
    useAuth.getState().sessionLost('ended');
    const s = useAuth.getState();
    expect(s.accessToken).toBeNull();
    expect(s.user).toBeNull();
    expect(s.role).toBeNull();
    expect(s.perms).toEqual([]);
    expect(s.license).toBeNull();
    expect(s.status).toBe('anonymous');
  });

  it('redirige vers /login en conservant la page d’origine', () => {
    fakeLocation('/patients/42', '?tab=docs');
    useAuth.getState().sessionLost('ended');
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy.mock.calls[0]![0]).toBe('https://app.test/login?next=%2Fpatients%2F42%3Ftab%3Ddocs&reason=ended');
  });

  it('ne redirige jamais depuis une page publique (connexion, lien signé) : pas de boucle', () => {
    for (const p of ['/login', '/forgot', '/reset-password', '/verify/QR-1']) {
      replaceSpy.mockReset();
      fakeLocation(p);
      useAuth.getState().sessionLost('ended');
      expect(replaceSpy, p).not.toHaveBeenCalled();
      useAuth.setState({ status: 'authed' });
    }
  });

  it('une seule navigation même si plusieurs requêtes constatent la perte en même temps', () => {
    fakeLocation('/patients/42');
    useAuth.getState().sessionLost('ended');
    useAuth.getState().sessionLost('ended');
    useAuth.getState().sessionLost('expired');
    expect(replaceSpy).toHaveBeenCalledTimes(1);
  });

  it('après reconnexion, une nouvelle perte de session redirige de nouveau (verrou ré-armé)', () => {
    fakeLocation('/patients/42');
    useAuth.getState().sessionLost('ended');
    expect(replaceSpy).toHaveBeenCalledTimes(1);

    // nouvelle session authentifiée : le verrou se ré-arme
    useAuth.setState({ status: 'authenticating' });
    useAuth.setState({ status: 'authed' });

    useAuth.getState().sessionLost('ended');
    expect(replaceSpy).toHaveBeenCalledTimes(2);
  });
});
