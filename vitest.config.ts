/**
 * Config Vitest — tests serveurs purs Node (aucun besoin de JSDOM).
 * L'alias « @ » est déclaré ici aussi : les tests qui importent un composant client
 * (ui.tsx, record-fields.tsx…) doivent résoudre les mêmes chemins que Next.js.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(here, 'apps/web/src') },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 20_000,
    pool: 'forks', // les tests écrivent dans des répertoires temporaires isolés
  },
});
