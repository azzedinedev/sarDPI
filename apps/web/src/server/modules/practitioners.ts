/**
 * MODULE INTERVENANTS (§6.6) — code {PFX}-{5 chiffres} par TYPE (MED/DEN/PHR/INF/TLB/RDG/RDL/SEC/ADM/INT),
 * le préfixe provient de settings.practitionerTypes (administrable) ; le code ne change jamais,
 * même si le type de l'intervenant évolue (cohérence historique).
 * + profil complet : spécialité, n° d'Ordre, signature et cachet (assets → PDF), disponibilité.
 */
import { z } from 'zod';
import { practitionerBaseZ, pickLabel } from '@sardpi/shared';
import { registerCrud, type CrudConfig } from '../http/crud';
import { route, type Ctx } from '../http/router';
import { allocateSuffixed } from '../codes/service';
import { getSection } from '../settings';
import { getDb } from '../data';
import { putFile } from '../storage';
import { notFound } from '../http/errors';
import { bumpTag } from '../cache';

function mapPractitioner(input: Record<string, unknown>): Record<string, unknown> {
  return {
    type_prefix: input.typePrefix,
    first_name: input.firstName,
    last_name: input.lastName,
    first_name_ar: input.firstNameAr ?? null,
    last_name_ar: input.lastNameAr ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    order_number: input.orderNumber ?? null,
    speciality_json: input.speciality ?? null,
    user_id: input.userId ?? null,
    signature_asset_id: input.signatureAssetId ?? null,
    stamp_asset_id: input.stampAssetId ?? null,
    availability: input.availability ?? null,
    active: input.active === false ? 0 : 1,
  };
}

export async function practitionerTypesMap(): Promise<Record<string, string>> {
  const st = (await getSection('practitionerTypes')) as { types: { prefix: string; label: Record<string, string> }[] };
  const out: Record<string, string> = {};
  for (const t of st.types) out[t.prefix] = pickLabel(t.label, 'fr');
  return out;
}

export function registerPractitioners(): void {
  const cfg: CrudConfig = {
    resource: 'practitioners',
    table: 'practitioners',
    perm: 'practitioner',
    softDelete: true,
    activeCol: 'active',
    search: ['code', 'first_name', 'last_name', 'first_name_ar', 'last_name_ar', 'order_number'],
    defaultSort: ['last_name', 'asc'],
    bodyCreate: practitionerBaseZ,
    bodyUpdate: practitionerBaseZ.partial(),
    mapInput: async (input) => mapPractitioner(input),
    allocateCode: async (tx, row) => {
      const prefix = String(row.type_prefix ?? 'INT');
      const { code } = await allocateSuffixed('practitioner', prefix, tx);
      return code;
    },
    decorate: async (rows) => {
      const types = await practitionerTypesMap();
      return rows.map((r) => ({ ...r, type_label: types[String(r.type_prefix)] ?? String(r.type_prefix ?? ''), full_name: `${String(r.last_name ?? '').toUpperCase()} ${r.first_name ?? ''}` }));
    },
    bump: ['refs'],
  };
  registerCrud(cfg);

  /** Liste des types/préfixes pour l'UI (select + libellés). */
  route({
    method: 'GET',
    path: '/practitioners/meta/types',
    cacheable: true,
    async handler() {
      const st = (await getSection('practitionerTypes')) as { types: { prefix: string; label: Record<string, string> }[] };
      return { types: st.types };
    },
  });

  /** Upload de la signature / du cachet (PNG/SVG → asset), utilisable dans les templates PDF. */
  route({
    method: 'POST',
    path: '/practitioners/:id/signature',
    perm: ['practitioner', 'update'],
    async handler(ctx: Ctx) {
      const id = Number(ctx.params.id);
      const db = ctx.db;
      if (!(await db.findOne('practitioners', { id }))) throw notFound();
      const form = await ctx.req.formData();
      const kind = String(form.get('kind') ?? 'signature'); // signature | stamp
      const file = form.get('file');
      if (!(file instanceof File)) throw new Error('fichier absent');
      const buf = Buffer.from(await file.arrayBuffer());
      const stored = await putFile(buf, file.name, 'assets', `P-${id}`);
      const asset = await db.insert('assets', {
        kind,
        file_name: stored.fileName,
        file_path: stored.storedPath,
        mime: stored.mime,
        size_bytes: stored.size,
        sha256: stored.sha256,
        created_at: new Date().toISOString(),
      });
      await db.update('practitioners', id, kind === 'stamp' ? { stamp_asset_id: asset.id } : { signature_asset_id: asset.id });
      await bumpTag('refs');
      return { ok: true, assetId: asset.id };
    },
  });
}
