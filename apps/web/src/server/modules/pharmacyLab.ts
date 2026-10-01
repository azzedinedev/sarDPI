/**
 * PHARMACIE & LABORATOIRE — médicaments (DCI + nom commercial, remboursement), stock par lot/péremption,
 * mouvements de stock, alertes ; référentiel des paramètres biologiques avec bornes (sexe/âge) + seuils critiques.
 * Import nomenclature via external_sources (mapping) — endpoint dédié dans admin/imports.
 */
import { z } from 'zod';
import { route, type Ctx } from '../http/router';
import { registerCrud } from '../http/crud';
import { ApiError, notFound } from '../http/errors';
import { allocateSuffixed } from '../codes/service';
import { getDb } from '../data';
import { bumpTag } from '../cache';
import { multiLabelZ } from '@sardpi/shared';

const drugZ = z.object({
  dci: z.string().min(2).max(80),
  tradeName: z.string().min(1).max(80),
  form: z.string().max(40).optional().nullable(),
  dosage: z.string().max(40).optional().nullable(),
  pack: z.string().max(60).optional().nullable(),
  atc: z.string().max(10).optional().nullable(),
  reimbursable: z.coerce.boolean().default(true),
  refundRate: z.number().min(0).max(100).optional().nullable(),
  priceDzd: z.number().min(0).optional().nullable(),
  labo: z.string().max(80).optional().nullable(),
});

export function registerPharmacyLab(): void {
  registerCrud({
    resource: 'drugs',
    table: 'drugs',
    perm: 'drug',
    softDelete: true,
    search: ['dci', 'trade_name', 'code'],
    defaultSort: ['dci', 'asc'],
    bodyCreate: drugZ,
    bodyUpdate: drugZ.partial(),
    mapInput: async (i) => ({
      dci: i.dci,
      trade_name: i.tradeName,
      form: i.form ?? null,
      dosage: i.dosage ?? null,
      pack: i.pack ?? null,
      atc: i.atc ?? null,
      reimbursable: i.reimbursable ? 1 : 0,
      refund_rate: i.refundRate ?? null,
      price_dzd: i.priceDzd ?? null,
      labo: i.labo ?? null,
    }),
    allocateCode: async (tx) => (await allocateSuffixed('drug', 'DRG', tx)).code,
    bump: ['refs'],
  });

  /* ---------------------------------------------------------------- stock */
  route({
    method: 'GET',
    path: '/stock',
    perm: ['record.pharmacy', 'view'],
    async handler(ctx: Ctx) {
      const db = ctx.db;
      const items = await db.find<Record<string, unknown>>('stock_items', { orderBy: [['expiry', 'asc']], limit: 2000 });
      const drugs = await db.find<Record<string, unknown>>('drugs', { limit: 5000 });
      const dBy = new Map(drugs.map((d) => [Number(d.id), d]));
      const today = new Date();
      const rows = items.map((it) => {
        const exp = it.expiry ? new Date(String(it.expiry)) : null;
        const near = exp ? (exp.getTime() - today.getTime()) / 86_400_000 : 999;
        const d = dBy.get(Number(it.drug_id));
        return {
          ...it,
          drug: d ? `${d.trade_name} ${d.dosage ?? ''}` : `#${it.drug_id}`,
          dci: d?.dci ?? null,
          qty: Number(it.qty ?? 0),
          low: Number(it.qty ?? 0) <= 10,
          out: Number(it.qty ?? 0) <= 0,
          expiringDays: exp ? Math.round(near) : null,
          expiringSoon: exp ? near <= 90 : false,
        };
      });
      return { rows };
    },
  });

  route({
    method: 'POST',
    path: '/stock/move',
    perm: ['record.pharmacy', 'update'],
    audit: { action: 'stock.move', entity: 'stock_items' },
    async handler(ctx: Ctx) {
      const input = await ctx.body(z.object({ drugId: z.number().int().positive(), batch: z.string().max(40), delta: z.number().int().min(-9999).max(9999), reason: z.string().max(80).optional(), expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }));
      const db = ctx.db;
      const item = await db.findOne<Record<string, unknown>>('stock_items', { drug_id: input.drugId, batch: input.batch });
      const qty = Number(item?.qty ?? 0) + input.delta;
      if (qty < 0) throw new ApiError(409, 'errors.conflict', 'stock insuffisant');
      if (item) await db.update('stock_items', Number(item.id), { qty });
      else await db.insert('stock_items', { drug_id: input.drugId, batch: input.batch, qty: Math.max(0, qty), expiry: input.expiry ?? null });
      await db.insert('stock_moves', { drug_id: input.drugId, delta: input.delta, reason: input.reason ?? null, at: new Date().toISOString(), by_user: ctx.user!.uid });
      return { ok: true, qty };
    },
  });

  route({
    method: 'GET',
    path: '/stock/movements',
    perm: ['record.pharmacy', 'view'],
    async handler(ctx: Ctx) {
      const db = ctx.db;
      const limit = Math.min(500, Math.max(10, Number(ctx.query.get('limit') ?? 100)));
      const moves = await db.find<Record<string, unknown>>('stock_moves', { orderBy: [['id', 'desc']], limit });
      const drugs = await db.find<Record<string, unknown>>('drugs', { limit: 5000 });
      const dBy = new Map(drugs.map((d) => [Number(d.id), d]));
      const users = await db.find<Record<string, unknown>>('users', { limit: 500 });
      const uBy = new Map(users.map((u) => [Number(u.id), u]));
      return {
        rows: moves.map((m) => ({
          id: Number(m.id),
          at: m.at,
          drug: dBy.get(Number(m.drug_id)) ? `${String(dBy.get(Number(m.drug_id))!.trade_name)}` : `#${m.drug_id}`,
          delta: Number(m.delta),
          reason: m.reason ?? null,
          who: uBy.get(Number(m.by_user)) ? String(uBy.get(Number(m.by_user))!.username) : null,
        })),
      };
    },
  });

  /* ------------------------------------------------ référentiel labo */
  const panelZ = z.object({ code: z.string().regex(/^[A-Z0-9_]{2,20}$/), name: multiLabelZ, specimen: z.string().max(30).optional(), active: z.coerce.boolean().default(true) });
  registerCrud({
    resource: 'lab-panels',
    table: 'lab_panels',
    perm: 'labref',
    softDelete: true,
    search: ['code'],
    defaultSort: ['code', 'asc'],
    bodyCreate: panelZ,
    bodyUpdate: panelZ.partial(),
    mapInput: async (i) => ({ code: i.code, name_json: i.name, specimen: i.specimen ?? null, active: i.active === false ? 0 : 1 }),
    bump: ['refs'],
  });

  const paramZ = z.object({
    panelId: z.number().int().positive(),
    paramKey: z.string().regex(/^[a-z0-9_]{2,40}$/),
    name: multiLabelZ,
    unit: z.string().max(16).optional().nullable(),
    refMin: z.number().optional().nullable(),
    refMax: z.number().optional().nullable(),
    critLow: z.number().optional().nullable(),
    critHigh: z.number().optional().nullable(),
    appliesSex: z.enum(['M', 'F']).optional().nullable(),
    ageMin: z.number().int().optional().nullable(),
    ageMax: z.number().int().optional().nullable(),
    sort: z.number().int().default(0),
  });
  registerCrud({
    resource: 'lab-parameters',
    table: 'lab_parameters',
    perm: 'labref',
    search: ['param_key'],
    defaultSort: ['panel_id', 'asc'],
    bodyCreate: paramZ,
    bodyUpdate: paramZ.partial(),
    mapInput: async (i) => ({
      panel_id: i.panelId,
      param_key: i.paramKey,
      name_json: i.name,
      unit: i.unit ?? null,
      ref_min: i.refMin ?? null,
      ref_max: i.refMax ?? null,
      crit_low: i.critLow ?? null,
      crit_high: i.critHigh ?? null,
      applies_sex: i.appliesSex ?? null,
      age_min: i.ageMin ?? null,
      age_max: i.ageMax ?? null,
      sort: i.sort ?? 0,
    }),
    bump: ['refs'],
  });

  route({
    method: 'GET',
    path: '/lab-panels/with-parameters',
    perm: ['labref', 'view'],
    cacheable: false,
    async handler(ctx: Ctx) {
      const db = ctx.db;
      const panels = await db.find<Record<string, unknown>>('lab_panels', { where: { active: 1 }, limit: 500 });
      const params = await db.find<Record<string, unknown>>('lab_parameters', { limit: 5000 });
      return { panels: panels.map((p) => ({ ...p, parameters: params.filter((x) => Number(x.panel_id) === Number(p.id)).sort((a, b) => Number(a.sort) - Number(b.sort)) })) };
    },
  });
}
