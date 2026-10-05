/**
 * TEST DE NON-RÉGRESSION — routes publiques (401 « Unauthorized » dans la console).
 * ------------------------------------------------------------------------------------
 * Bug corrigé : GET /qr?data=… exigeait un jeton Bearer (auth par défaut du routeur), alors que
 * l'image est appelée par `<img src="/api/v1/qr?data=…">` (page ordonnance) : un <img> ne peut pas
 * transporter l'en-tête Authorization (le jeton d'accès vit en mémoire) → 401 systématique et
 * vignette QR cassée. Le contenu du QR (URL /verify/:token) est pourtant destiné à être scanné
 * par un tiers non authentifié.
 *
 * Ces tests verrouillent le contrat des routes qui DOIVENT rester publiques/licence-free.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sardpi-public-'));
fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
process.env.SARDPI_ROOT = tmp;

const { registerPublic } = await import('../apps/web/src/server/modules/public');
const { getRoutes } = await import('../apps/web/src/server/http/router');

registerPublic();
const routes = getRoutes();
const find = (method: string, p: string) => routes.find((r) => r.method === method && r.path === p);

describe('routes publiques', () => {
  it('/qr est public (image appelée par <img>) et disponible même licence expirée', () => {
    const r = find('GET', '/qr');
    expect(r, 'route GET /qr absente').toBeTruthy();
    expect(r!.auth).toBe(false);
    expect(r!.licenseFree).toBe(true);
  });

  it('/i18n/:lang/:ns reste public (chargement des dictionnaires avant/après connexion)', () => {
    const r = find('GET', '/i18n/:lang/:ns');
    expect(r!.auth).toBe(false);
  });

  it('/verify/:token et /files/:token restent publics (pages scannées hors session)', () => {
    expect(find('GET', '/verify/:token')!.auth).toBe(false);
    expect(find('GET', '/files/:token')!.auth).toBe(false);
  });
});
