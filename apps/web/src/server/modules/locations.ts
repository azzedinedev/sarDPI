/**
 * MODULE LIEUX — LOC-001 (préfixe/padding configurables), capacité, horaires par jour
 * (jours de semaine selon profil pays : vendredi-samedi = week-end en Algérie).
 */
import { locationBaseZ, pickLabel } from '@sardpi/shared';
import { registerCrud, type CrudConfig } from '../http/crud';
import { allocateSuffixed } from '../codes/service';

function mapLocation(input: Record<string, unknown>): Record<string, unknown> {
  return {
    kind: input.kind ?? 'cabinet',
    name_json: input.name,
    capacity: input.capacity ?? 1,
    building: input.building ?? null,
    address: input.address ?? null,
    wilaya_code: input.wilayaCode ?? null,
    open_hours_json: input.openHours ?? null,
    active: input.active === false ? 0 : 1,
  };
}

export function registerLocations(): void {
  const cfg: CrudConfig = {
    resource: 'locations',
    table: 'locations',
    perm: 'location',
    softDelete: true,
    activeCol: 'active',
    search: ['code', 'building', 'address'],
    defaultSort: ['kind', 'asc'],
    bodyCreate: locationBaseZ,
    bodyUpdate: locationBaseZ.partial(),
    mapInput: async (input) => mapLocation(input),
    allocateCode: async (tx, row) => (await allocateSuffixed('location', 'LOC', tx)).code,
    decorate: async (rows, ctx) => {
      const lang = ctx.user?.locale ?? 'fr';
      return rows.map((r) => ({ ...r, name: pickLabel((r.name_json ?? {}) as never, lang), capacity: Number(r.capacity ?? 1) }));
    },
    bump: ['refs'],
  };
  registerCrud(cfg);
}
