/**
 * TEST DE NON-RÉGRESSION — chargement des fichiers .env du monorepo.
 * ------------------------------------------------------------------
 * Défaut corrigé : Next.js ne charge que les .env situés dans apps/web, alors que les scripts
 * vite-node (seed, db:sync, db:export) ont pour racine celle du monorepo. Un .env.local placé
 * d'un seul côté était donc lu par l'un et ignoré par l'autre — SILENCIEUSEMENT.
 *
 * Conséquence réelle observée avant correctif : le seed (vite, racine du monorepo) chiffrait les
 * champs sensibles en AES-256-GCM grâce à ENC_KEYS, tandis que le serveur web (Next, cwd
 * apps/web) ne voyait ni ENC_KEYS ni AUTH_SECRET → JWT dérivé d'un repli instable et téléphone /
 * e-mail / NIN / n° Chifa du patient impossibles à déchiffrer à l'affichage (loi 18-07).
 *
 * Ces tests verrouillent les trois garanties du chargeur : les deux emplacements sont lus,
 * l'ordre de priorité est déterministe, et l'environnement réel du processus garde la main.
 */
import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadRootEnv } from '../apps/web/src/server/config';

/** Crée une arborescence de monorepo minimale et retourne sa racine. */
function fakeRoot(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sardpi-env-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
  return root;
}

const touched = new Set<string>();

/** Enregistre une variable posée par le test pour la retirer ensuite (isolation entre tests). */
function setEnv(key: string, value: string): void {
  touched.add(key);
  process.env[key] = value;
}

afterEach(() => {
  for (const key of touched) delete process.env[key];
  touched.clear();
});

describe('chargeur .env du monorepo', () => {
  it('lit le .env.local de la RACINE — emplacement utilisé par les scripts vite-node', () => {
    const root = fakeRoot({
      '.env.local': ['# commentaire ignoré', '', 'SARDPI_T_ROOT=desde-la-racine', 'ENC_KEYS=1:' + 'a'.repeat(64)].join('\n'),
    });
    // ENC_KEYS peut déjà être posé par le vrai .env.local chargé à l'import de config.ts :
    // on le retire le temps du test pour vérifier précisément que le chargeur l'apporte,
    // puis on le restaure (les autres fichiers de tests s'appuient sur la crypto).
    const savedEnc = process.env.ENC_KEYS;
    delete process.env.ENC_KEYS;
    try {
      const loaded = loadRootEnv(root);
      expect(process.env.SARDPI_T_ROOT).toBe('desde-la-racine');
      // Cas concret du défaut : ENC_KEYS doit atteindre le processus du serveur web.
      expect(process.env.ENC_KEYS).toMatch(/^1:a{64}$/);
      expect(loaded).toContain('.env.local');
    } finally {
      if (savedEnc !== undefined) process.env.ENC_KEYS = savedEnc;
      else delete process.env.ENC_KEYS;
    }
  });

  it('lit aussi apps/web/.env.local — emplacement documenté par le README', () => {
    const root = fakeRoot({
      [path.join('apps', 'web', '.env.local')]: 'SARDPI_T_APP=depuis-apps-web\n',
    });
    const loaded = loadRootEnv(root);
    expect(process.env.SARDPI_T_APP).toBe('depuis-apps-web');
    expect(loaded.some((f) => f.split(/[\\/]/).includes('web'))).toBe(true);
  });

  it("n'écrase JAMAIS une variable déjà fournie par l'environnement (pm2, Docker, $env: PowerShell)", () => {
    const root = fakeRoot({ '.env.local': 'SARDPI_T_ROOT=fichier\nSARDPI_T_ONLY_FILE=absent-du-processus\n' });
    setEnv('SARDPI_T_ROOT', 'processus-gagne');
    loadRootEnv(root);
    expect(process.env.SARDPI_T_ROOT).toBe('processus-gagne');
    expect(process.env.SARDPI_T_ONLY_FILE).toBe('absent-du-processus');
  });

  it('priorité déterministe : racine avant apps/web, .env.local avant .env', () => {
    const root = fakeRoot({
      '.env.local': 'SARDPI_T_WHO=root-local\n',
      '.env': 'SARDPI_T_WHO=root-env\nSARDPI_T_SECOND=root-env\n',
      [path.join('apps', 'web', '.env.local')]: 'SARDPI_T_WHO=app-local\nSARDPI_T_SECOND=app-local\nSARDPI_T_THIRD=app-local\n',
    });
    loadRootEnv(root);
    expect(process.env.SARDPI_T_WHO).toBe('root-local');
    expect(process.env.SARDPI_T_SECOND).toBe('root-env');
    expect(process.env.SARDPI_T_THIRD).toBe('app-local');
  });

  it('gère CRLF (Windows PowerShell), guillemets, `export ` et lignes invalides', () => {
    const root = fakeRoot({
      '.env.local': [
        'SARDPI_T_CRLF=valeur-windows\r',
        'export SARDPI_T_EXPORT=avec-prefixe',
        'SARDPI_T_QUOTED="entre-guillemets"',
        "SARDPI_T_SINGLE='entre-apostrophes'",
        'SARDPI_T_EQ=a=b=c',
        '#SARDPI_T_COMMENT=ignore',
        'PAS_DE_SIGNE_EGAL',
        '=sans_cle',
      ].join('\r\n'),
    });
    loadRootEnv(root);
    expect(process.env.SARDPI_T_CRLF).toBe('valeur-windows');
    expect(process.env.SARDPI_T_EXPORT).toBe('avec-prefixe');
    expect(process.env.SARDPI_T_QUOTED).toBe('entre-guillemets');
    expect(process.env.SARDPI_T_SINGLE).toBe('entre-apostrophes');
    expect(process.env.SARDPI_T_EQ).toBe('a=b=c');
    expect(process.env.SARDPI_T_COMMENT).toBeUndefined();
  });

  it('ne fait rien si aucun fichier .env existe (production : variables fournies par le processus)', () => {
    const root = fakeRoot({});
    expect(loadRootEnv(root)).toEqual([]);
  });
});
