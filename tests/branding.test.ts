/**
 * IDENTITÉ VISUELLE (logo / icône d'onglet) — sécurité du téléversement et contrat des routes.
 * --------------------------------------------------------------------------------------------
 * Le logo est affiché AVANT authentification (écran de connexion) : sa route de diffusion est donc
 * publique, ce qui impose des garde-fous vérifiés ici.
 *   1. le type réel est détecté par MAGIC BYTES — un « logo.pdf » ou « logo.txt » est refusé même si
 *      le navigateur déclare `image/png` ;
 *   2. le SVG est accepté mais ASSAINI (script, gestionnaires d'événements, `javascript:`, références
 *      externes, `@import`) puis servi derrière une CSP `sandbox` : un logo ne doit pas pouvoir
 *      exécuter du code sur l'origine de l'application ;
 *   3. la taille est bornée (refus 413, pas un téléchargement infini) ;
 *   4. les routes d'écriture exigent `setting:update` et sont auditées ; la lecture publique est
 *      `licenseFree` (un logo doit s'afficher même avec une licence à régulariser).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sardpi-branding-'));
fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
process.env.SARDPI_ROOT = tmp;

const { sanitizeSvg, validateBrandingFile, brandingHeaders } = await import('../apps/web/src/server/branding');
const { registerBranding } = await import('../apps/web/src/server/modules/branding');
const { registerVaccination } = await import('../apps/web/src/server/modules/vaccination');
const { registerAdmin } = await import('../apps/web/src/server/modules/admin');
const { getRoutes } = await import('../apps/web/src/server/http/router');
const { generalZ } = await import('../apps/web/src/server/settings');

registerBranding();
registerVaccination();
registerAdmin();
const routes = getRoutes();
const find = (method: string, p: string) => routes.find((r) => r.method === method && r.path === p);

/* ------------------------------------------------------------------ fichiers de test */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(16)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');

function fail(fn: () => unknown): { status: number; code: string } {
  try {
    fn();
  } catch (e) {
    const err = e as { status?: number; code?: string };
    return { status: err.status ?? 0, code: err.code ?? '' };
  }
  throw new Error('aucune erreur levée');
}

describe('validation du fichier (le mime déclaré par le navigateur ne fait jamais foi)', () => {
  it('PNG, JPEG, WEBP et GIF sont acceptés, avec mime et extension déduits du CONTENU', () => {
    expect(validateBrandingFile('logo', PNG, 'logo.png')).toMatchObject({ mime: 'image/png', ext: 'png' });
    expect(validateBrandingFile('logo', JPEG, 'photo.jpeg')).toMatchObject({ mime: 'image/jpeg', ext: 'jpg' });
    expect(validateBrandingFile('logo', WEBP, 'img.webp')).toMatchObject({ mime: 'image/webp', ext: 'webp' });
    expect(validateBrandingFile('favicon', GIF, 'ico.gif')).toMatchObject({ mime: 'image/gif', ext: 'gif' });
    // extension mensongère : le contenu décide (un « logo.txt » qui est un PNG reste un PNG)
    expect(validateBrandingFile('logo', PNG, 'logo.txt')).toMatchObject({ mime: 'image/png', ext: 'png' });
  });

  it('PDF, texte et fichier vide sont refusés (400 errors.badFileType / validation)', () => {
    expect(fail(() => validateBrandingFile('logo', PDF, 'logo.pdf'))).toMatchObject({ status: 400, code: 'errors.badFileType' });
    expect(fail(() => validateBrandingFile('logo', Buffer.from('<html><body>logo</body></html>'), 'logo.html')).code).toBe('errors.badFileType');
    expect(fail(() => validateBrandingFile('logo', Buffer.alloc(0), 'vide.png')).code).toBe('errors.validation');
  });

  it('taille bornée : refus 413 au-delà de la limite du type (logo 1 Mo, icône 256 Ko)', () => {
    const big = Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]);
    expect(fail(() => validateBrandingFile('logo', big, 'huge.png'))).toMatchObject({ status: 413, code: 'errors.uploadTooLarge' });
    const bigIcon = Buffer.concat([PNG, Buffer.alloc(256 * 1024)]);
    expect(fail(() => validateBrandingFile('favicon', bigIcon, 'huge.png')).status).toBe(413);
    // juste sous la limite : accepté
    expect(validateBrandingFile('favicon', Buffer.concat([PNG, Buffer.alloc(256 * 1024 - 64)]), 'ok.png').mime).toBe('image/png');
  });
});

describe('SVG : accepté seulement assaini', () => {
  const dirty = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)" width="64" height="64">
  <script>alert(2)</script>
  <foreignObject><body xmlns="http://www.w3.org/1999/xhtml">x</body></foreignObject>
  <rect width="10" height="10" fill="url(http://evil.test/x.png)" onclick="alert(4)"/>
  <a href="javascript:alert(3)"><text>x</text></a>
  <style>@import url(http://evil.test/a.css); .a{fill:red}</style>
  <image href="https://evil.test/logo.png"/>
</svg>`;

  it('retire script, gestionnaires d’événements, javascript:, inclusions et ressources externes', () => {
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toMatch(/<script/i);
    expect(clean).not.toMatch(/onload|onclick/i);
    expect(clean).not.toMatch(/javascript:/i);
    expect(clean).not.toMatch(/<foreignObject/i);
    expect(clean).not.toMatch(/@import/i);
    expect(clean).not.toMatch(/https?:\/\/evil\.test/i);
    expect(clean).not.toMatch(/<image/i);
    // le dessin reste utilisable
    expect(clean).toMatch(/<svg[\s>]/i);
    expect(clean).toMatch(/<rect/i);
    expect(clean).toMatch(/width="64"/);
  });

  it('un SVG téléversé est réécrit assaini ; un faux SVG est refusé', () => {
    const res = validateBrandingFile('logo', Buffer.from(dirty, 'utf8'), 'logo.svg');
    expect(res).toMatchObject({ mime: 'image/svg+xml', ext: 'svg' });
    expect(res.buf.toString('utf8')).not.toMatch(/<script|onload|javascript:/i);
    // un fichier .svg qui n'est pas du SVG (contenu HTML) → refus
    expect(fail(() => validateBrandingFile('logo', Buffer.from('<html><body>x</body></html>', 'utf8'), 'logo.svg')).code).toBe('errors.badFileType');
    // contenu SVG sans balise <svg> après assainissement → refus
    expect(fail(() => validateBrandingFile('logo', Buffer.from('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e "y">]>', 'utf8'), 'logo.svg')).code).toBe('errors.badFileType');
  });

  it('diffusion : le SVG part avec une CSP sandbox, jamais les images raster', () => {
    const svg = brandingHeaders('image/svg+xml', '"abc"');
    expect(svg['content-security-policy']).toContain("default-src 'none'");
    expect(svg['content-security-policy']).toContain('sandbox');
    expect(svg['x-content-type-options']).toBe('nosniff');
    expect(svg['cache-control']).toContain('public');
    const png = brandingHeaders('image/png', '"abc"');
    expect(png['content-security-policy']).toBeUndefined();
    expect(png['content-type']).toBe('image/png');
  });
});

describe('réglage « general » : chemins + révisions, jamais les octets en base', () => {
  it('les quatre champs existent et sont vides par défaut (monogramme généré)', () => {
    const parsed = generalZ.parse({});
    expect(parsed).toMatchObject({ logoPath: '', logoRev: '', faviconPath: '', faviconRev: '' });
  });

  it('longueur bornée (un chemin de stockage n’a pas 4 000 caractères)', () => {
    expect(generalZ.safeParse({ logoPath: 'x'.repeat(400) }).success).toBe(false);
    expect(generalZ.safeParse({ logoPath: 'branding/logo-ab12cd.png', logoRev: 'ab12cdab12cd' }).success).toBe(true);
  });
});

describe('contrat des routes', () => {
  it('diffusion publique du logo : sans jeton (écran de connexion) et même licence expirée', () => {
    const r = find('GET', '/branding/:kind');
    expect(r, 'route GET /branding/:kind absente').toBeTruthy();
    expect(r!.auth).toBe(false);
    expect(r!.licenseFree).toBe(true);
  });

  it('écriture réservée à setting:update, lecture d’état à setting:view, les deux auditées', () => {
    expect(find('GET', '/admin/branding')!.perm).toEqual(['setting', 'view']);
    const up = find('POST', '/admin/branding/:kind')!;
    expect(up.perm).toEqual(['setting', 'update']);
    expect(up.audit?.action).toBe('branding.upload');
    const del = find('DELETE', '/admin/branding/:kind')!;
    expect(del.perm).toEqual(['setting', 'update']);
    expect(del.audit?.action).toBe('branding.remove');
  });

  it('la liste des thèmes pour le sélecteur de Paramètres relève de setting:view (pas theme:view)', () => {
    const r = find('GET', '/admin/themes/names');
    expect(r, 'route GET /admin/themes/names absente').toBeTruthy();
    expect(r!.perm).toEqual(['setting', 'view']);
    // la page d'administration des thèmes (édition de manifeste, approbation JS) reste au module theme
    expect(find('GET', '/admin/themes')!.perm).toEqual(['theme', 'view']);
    expect(find('POST', '/admin/themes/approve')!.perm).toEqual(['theme', 'update']);
  });

  it('carnet vaccinal : calendrier et carnet en lecture « vaccination », génération en création', () => {
    expect(find('GET', '/vaccinations/calendar')!.perm).toEqual(['vaccination', 'view']);
    expect(find('GET', '/vaccinations/stats')!.perm).toEqual(['vaccination', 'view']);
    expect(find('GET', '/patients/:id/vaccination')!.perm).toEqual(['vaccination', 'view']);
    const gen = find('POST', '/patients/:id/vaccination/generate')!;
    expect(gen.perm).toEqual(['vaccination', 'create']);
    expect(gen.audit?.action).toBe('vaccinations.generate');
  });

  it('CRUD des doses : verbes mappés sur le module vaccination (RBAC générique)', () => {
    expect(find('GET', '/vaccinations')!.perm).toEqual(['vaccination', 'view']);
    expect(find('POST', '/vaccinations')!.perm).toEqual(['vaccination', 'create']);
    expect(find('PUT', '/vaccinations/:id')!.perm).toEqual(['vaccination', 'update']);
    expect(find('DELETE', '/vaccinations/:id')!.perm).toEqual(['vaccination', 'delete']);
    expect(find('GET', '/vaccinations/export')!.perm).toEqual(['vaccination', 'export']);
  });

  it('/vaccinations/stats ne peut pas être avalé par /vaccinations/:id (spécificité)', () => {
    const stats = routes.findIndex((r) => r.path === '/vaccinations/stats');
    const byId = routes.findIndex((r) => r.path === '/vaccinations/:id' && r.method === 'GET');
    expect(stats).toBeGreaterThanOrEqual(0);
    expect(byId).toBeGreaterThanOrEqual(0);
    expect(stats).toBeLessThan(byId);
  });
});
