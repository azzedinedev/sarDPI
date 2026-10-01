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
    // CSP : 'unsafe-inline' pour les styles est un compromis assumé (Radix/Framer posent du style inline) ;
    // les scripts inline sont interdits, les workers/blob autorisés pour l'aperçu PDF.
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' https://challenges.cloudflare.com https://hcaptcha.com https://www.google.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ');
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
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
