/** Config Vitest — tests serveurs purs Node (aucun besoin de JSDOM). */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 20_000,
    pool: 'forks', // les tests écrivent dans des répertoires temporaires isolés
  },
});
