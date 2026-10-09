/**
 * Middleware sécurité : CSP à NONCE par requête (voir lib/csp.ts pour la rationale complète) +
 * PORTE DE SESSION.
 * Next lit « x-nextjs-csp-nonce » sur la requête et pose l'attribut nonce=… sur tous ses scripts
 * (y compris les inline RSC du streaming) ; la réponse doit porter le header CSP avec le MÊME nonce.
 * Runtime edge : uniquement Web Crypto — aucun fs ici (le reste de la sécurité vit dans les routes).
 *
 * PORTE DE SESSION : sans cookie de session, une page applicative n'est JAMAIS rendue — la réponse
 * est une redirection vers /login?next=…&reason=expired. C'est la première ligne de la règle
 * « aucun affichage sans session valide » : elle évite de servir un shell vide, de laisser le
 * navigateur déclencher des dizaines d'appels d'API voués au 401, et de faire clignoter un écran
 * de chargement avant l'expulsion. La VALIDITÉ de la session (révocation, expiration, compte
 * désactivé) n'est pas vérifiable ici — le jeton est opaque et la base n'est pas accessible depuis
 * l'edge : elle est tranchée à chaque appel d'API (guard.authenticateOutcome) et, côté client, par
 * la redirection immédiate au premier 401 non récupérable (lib/api.ts → stores/auth).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp } from '@/lib/csp';
import { SESSION_COOKIE, loginUrl, needsSession } from '@/lib/session-gate';

const DEV = process.env.NODE_ENV !== 'production';

function withSecurityHeaders(res: NextResponse, req: NextRequest, nonce: string): NextResponse {
  res.headers.set('Content-Security-Policy', buildCsp({ nonce, dev: DEV }));
  // no-store sur le HTML : les données de santé ne doivent jamais atterrir dans un cache partagé/CDN.
  // (pages & SSR uniquement — les assets _next/* sont exclus du matcher et gardent leur cache immutable)
  res.headers.set('Cache-Control', 'no-store');
  void req;
  return res;
}

export function middleware(req: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const { pathname, search } = req.nextUrl;

  // ---- porte de session : navigation de page sans cookie ⇒ connexion, jamais de HTML applicatif
  const isNavigation = req.method === 'GET' || req.method === 'HEAD';
  if (isNavigation && needsSession(pathname) && !req.cookies.get(SESSION_COOKIE)?.value) {
    const url = req.nextUrl.clone();
    const target = new URL(loginUrl(`${pathname}${search}`, 'expired'), url.origin);
    const redirectRes = NextResponse.redirect(target);
    redirectRes.cookies.delete(SESSION_COOKIE);
    redirectRes.cookies.delete('sardpi_csrf');
    return withSecurityHeaders(redirectRes, req, nonce);
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nextjs-csp-nonce', nonce);
  requestHeaders.set('x-pathname', pathname);
  requestHeaders.set('x-search', search);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  return withSecurityHeaders(res, req, nonce);
}

export const config = {
  // API : gérée par le routeur applicatif (headers no-store déjà posés par route.ts) — inutile de
  // passer par l'edge ; _next/static : fingerprintés ; /fonts + icônes : cache long posé par
  // next.config headers() — le middleware ne doit PAS y mettre no-store.
  matcher: ['/((?!api/|_next/|fonts/|icon\\.svg|manifest\\.webmanifest).*)'],
};
