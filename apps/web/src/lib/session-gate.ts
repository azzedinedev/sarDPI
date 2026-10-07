/**
 * PORTE DE SESSION — décide, SANS toucher au DOM ni au serveur applicatif, si une requête peut
 * atteindre une page de l'application ou doit être renvoyée vers la connexion.
 * ---------------------------------------------------------------------------------------------
 * Deux usages, un seul jeu de règles (donc pas de divergence possible) :
 *
 *  1. MIDDLEWARE (edge, avant tout HTML) : sans cookie de session, aucune page applicative n'est
 *     servie — le navigateur reçoit une redirection vers /login et ne peut pas afficher un shell
 *     vide, ni déclencher des dizaines d'appels d'API voués au 401.
 *  2. CLIENT (store d'authentification) : même calcul pour construire l'URL de retour après une
 *     session cassée en cours d'utilisation (révocation, expiration, redémarrage du serveur).
 *
 * Le cookie de session est un jeton OPAQUE (seul son hash existe en base) : l'edge ne peut pas le
 * valider, seulement constater sa présence. La VALIDITÉ est vérifiée à chaque appel d'API côté
 * serveur (guard.authenticate) : c'est cette vérification qui fait autorité, et le client redirige
 * dès qu'un 401 non récupérable survient.
 */

/** Nom du cookie de session (refresh httpOnly) — source unique partagée serveur/middleware/client. */
export const SESSION_COOKIE = 'sardpi_rt';

/** Nom du cookie de double-submit CSRF (non httpOnly par conception). */
export const CSRF_COOKIE = 'sardpi_csrf';

/**
 * Chemins accessibles SANS session : connexion, récupération/activation de compte, liens signés
 * (vérification QR, dossier partagé), sondes de supervision. Tout le reste exige une session.
 */
export const PUBLIC_PATHS = ['/login', '/forgot', '/reset-password', '/verify', '/healthz', '/readyz'] as const;

/** Préfixe « raison » transmis à /login pour expliquer la redirection. */
export type LoginReason = 'expired' | 'ended';

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Ressource statique (icône, police, image, manifeste) ? Les routes applicatives n'ont jamais de
 * point dans leur dernier segment : ce test évite de rediriger un fichier vers /login.
 */
export function isAssetPath(pathname: string): boolean {
  const last = pathname.split('/').pop() ?? '';
  return last.includes('.');
}

/** Cette requête doit-elle passer par la connexion ? (utilisé par le middleware) */
export function needsSession(pathname: string): boolean {
  if (isPublicPath(pathname) || isAssetPath(pathname)) return false;
  return true;
}

/**
 * URL de connexion avec retour : `next` ramène l'utilisateur là où il était, `reason` permet à
 * l'écran de connexion d'expliquer la redirection (sans jamais afficher un code brut).
 */
export function loginUrl(next?: string | null, reason?: LoginReason): string {
  const params = new URLSearchParams();
  const target = next && next.startsWith('/') && !next.startsWith('/login') ? next : null;
  if (target) params.set('next', target);
  if (reason) params.set('reason', reason);
  const qs = params.toString();
  return qs ? `/login?${qs}` : '/login';
}

/**
 * Redirection nécessaire pour la page courante ? `null` = pas de redirection.
 * Utilisé par le client : on ne renvoie jamais /login vers /login (boucle), ni les pages publiques.
 */
export function redirectTarget(pathname: string, search = ''): string | null {
  if (isPublicPath(pathname)) return null;
  return loginUrl(`${pathname}${search}`, 'ended');
}
