/**
 * Middleware sécurité : CSP à NONCE par requête (voir lib/csp.ts pour la rationale complète).
 * Next lit « x-nextjs-csp-nonce » sur la requête et pose l'attribut nonce=… sur tous ses scripts
 * (y compris les inline RSC du streaming) ; la réponse doit porter le header CSP avec le MÊME nonce.
 * Runtime edge : uniquement Web Crypto — aucun fs ici (le reste de la sécurité vit dans les routes).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp } from '@/lib/csp';

const DEV = process.env.NODE_ENV !== 'production';

export function middleware(req: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nextjs-csp-nonce', nonce);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set('Content-Security-Policy', buildCsp({ nonce, dev: DEV }));
  // no-store sur le HTML : les données de santé ne doivent jamais atterrir dans un cache partagé/CDN.
  // (pages & SSR uniquement — les assets _next/* sont exclus du matcher et gardent leur cache immutable)
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export const config = {
  // API : gérée par le routeur applicatif (headers no-store déjà posés par route.ts) — inutile de
  // passer par l'edge ; _next/static : fingerprintés ; /fonts + icônes : cache long posé par
  // next.config headers() — le middleware ne doit PAS y mettre no-store.
  matcher: ['/((?!api/|_next/|fonts/|icon\\.svg|manifest\\.webmanifest).*)'],
};
