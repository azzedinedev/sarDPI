/**
 * MODULE IDENTITÉ VISUELLE — logo de l'application + icône d'onglet (Paramètres » Général).
 * -----------------------------------------------------------------------------------------
 *  - `GET /branding/:kind`      : diffusion PUBLIQUE des octets (l'écran de connexion affiche le
 *                                 logo avant toute authentification) — ETag + `If-None-Match` (304),
 *                                 jamais de chemin physique ni d'id dans l'URL ;
 *  - `GET /admin/branding`      : état courant (nom de l'app, logo, icône) pour l'écran d'administration ;
 *  - `POST /admin/branding/:kind` (multipart) : téléversement — taille bornée, type vérifié par
 *                                 magic bytes, SVG assaini (voir `server/branding.ts`) ;
 *  - `DELETE /admin/branding/:kind`           : retour au monogramme / à l'icône par défaut.
 * Les deux écritures sont auditées (`branding.upload`, `branding.remove`) et invalident le cache
 * « branding » : le changement apparaît au prochain rendu, sans redémarrage.
 */
import { route, type Ctx } from '../http/router';
import { ApiError, notFound } from '../http/errors';
import { BRANDING_KINDS, brandingHeaders, brandingState, clearBrandingImage, readBrandingImage, setBrandingImage, type BrandingKind } from '../branding';
import { env } from '../config';

function kindOf(raw: string | undefined): BrandingKind {
  const kind = String(raw ?? '') as BrandingKind;
  if (!BRANDING_KINDS.includes(kind)) throw notFound();
  return kind;
}

export function registerBranding(): void {
  /* ------------------------------------------------------------------ diffusion publique */
  route({
    method: 'GET',
    path: '/branding/:kind',
    auth: false,
    licenseFree: true,
    cacheable: true,
    async handler(ctx: Ctx) {
      const kind = kindOf(ctx.params.kind);
      const state = await brandingState();
      const image = state[kind];
      if (!image) throw notFound();
      const file = readBrandingImage(kind, image.path);
      if (!file) throw notFound();
      const headers = brandingHeaders(file.mime, file.etag);
      if (ctx.req.headers.get('if-none-match') === file.etag) return new Response(null, { status: 304, headers });
      return new Response(new Uint8Array(file.buf), { status: 200, headers });
    },
  });

  /* ------------------------------------------------------------------ administration */
  route({
    method: 'GET',
    path: '/admin/branding',
    perm: ['setting', 'view'],
    cacheable: true,
    handler: async () => await brandingState(),
  });

  route({
    method: 'POST',
    path: '/admin/branding/:kind',
    perm: ['setting', 'update'],
    audit: { action: 'branding.upload', entity: 'settings' },
    async handler(ctx: Ctx) {
      const kind = kindOf(ctx.params.kind);
      const form = await ctx.req.formData().catch(() => {
        throw new ApiError(400, 'errors.validation', 'corps multipart invalide');
      });
      const file = form.get('file');
      if (!(file instanceof File)) throw new ApiError(400, 'errors.validation', 'fichier absent (champ « file »)', { file: true });
      if (file.size > env.maxUploadBytes) {
        throw new ApiError(413, 'errors.uploadTooLarge', undefined, { mb: Math.round(env.maxUploadBytes / 1024 / 1024) });
      }
      const buf = Buffer.from(await file.arrayBuffer());
      const branding = await setBrandingImage(kind, buf, file.name, ctx.user?.uid ?? null);
      return { ok: true, kind, branding };
    },
  });

  route({
    method: 'DELETE',
    path: '/admin/branding/:kind',
    perm: ['setting', 'update'],
    audit: { action: 'branding.remove', entity: 'settings' },
    async handler(ctx: Ctx) {
      const kind = kindOf(ctx.params.kind);
      const branding = await clearBrandingImage(kind, ctx.user?.uid ?? null);
      return { ok: true, kind, branding };
    },
  });
}
