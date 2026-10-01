/**
 * Configuration Next.js — sarDPI.
 * Monorepo npm workspaces : transpilePackages sur @sardpi/shared (sources TS partagées front/back).
 * serverExternalPackages : paquets Node natifs/lourds non bundlés (drivers BD, mail, PDF, polices WASM).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@sardpi/shared'],
  serverExternalPackages: [
    'mysql2',
    'pg',
    'pino',
    'nodemailer',
    'puppeteer',
    'pdf-lib',
    'bwip-js',
    'qrcode',
    'hash-wasm',
  ],
  outputFileTracingRoot: repoRoot,
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    // Les handlers d'API utilisent fs/net : runtime nodejs explicite (voir chaque route).
    proxyTimeout: 60_000,
  },
  async headers() {
    // En-têtes de sécurité "style helmet" (le paquet helmet est prévu pour le serveur séparé optionnel).
    // ⚠ La CSP n'est PAS ici : elle exige un NONCE par requête (scripts inline du App Router/streaming
    // RSC) → construite dans src/middleware.ts (+ src/lib/csp.ts). Un header statique ne peut pas porter
    // de nonce et bloquerait l'hydratation (et en dev, tout HMR). Les autres en-têtes restent statiques.
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(), microphone=(), payment=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
      {
        // Assets versionnés (fonts, immutables)
        source: '/fonts/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
};

export default nextConfig;
