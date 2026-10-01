/**
 * MOTEUR CRUD GÉNÉRIQUE (API) piloté par configuration — consommé par le composant `CrudModule` (UI).
 * Par collection : liste (recherche simple multi-champs, filtres avancés ET/OU, tri, PAGINATION SERVEUR,
 * scope actif/archivé/tous), détail, création, mise à jour, suppression LOGIQUE, restauration, archivage,
 * activation, actions groupées, export CSV (BOM UTF-8 pour Excel FR/AR).
 * Transverse : permission RBAC sur chaque verbe, contrôle d'objet (anti-IDOR) via cfg.access,
 * audit + diff avant/après, invalidation des tags de cache, code géré par `allocateCode` (transaction + verrou).
 */
import { z } from 'zod';
import { paginationZ, filterGroupZ } from '@sardpi/shared';
import { route, type RouteDef, type Ctx } from './router';
import { ApiError, notFound } from './errors';
import { tableMeta } from '../data/schema';
import type { Row, WhereCond, DataAdapter } from '../data/types';
import { bumpTag } from '../cache';
import { audit } from '../audit';
import { shallowDiff } from '../util';

export interface CrudConfig {
  resource: string; // segment d'URL
  table: string;
  perm: string; // module RBAC (les verbes mappent view/create/update/delete/archive/export)
  search?: string[]; // colonnes visées par q= (OR)
  defaultSort?: [string, 'asc' | 'desc'];
  softDelete?: boolean; // archived_at
  activeCol?: string | null;
  bodyCreate: z.ZodTypeAny;
  bodyUpdate?: z.ZodTypeAny;
  /** input validé -> colonnes de la table */
  mapInput?: (parsed: Record<string, unknown>, ctx: Ctx, mode: 'create' | 'update', prev?: Row) => Promise<Row> | Row;
  decorate?: (rows: Row[], ctx: Ctx) => Promise<Row[]>;
  /** allocation du code métier dans la transaction (serveur uniquement, jamais depuis le client) */
  allocateCode?: (tx: DataAdapter, row: Row, ctx: Ctx) => Promise<string | null>;
  /** hook métier post-création (événements d'historique, tokens de vérification…) */
  onAfterCreate?: (id: number, row: Row, ctx: Ctx) => Promise<void>;
  onAfterUpdate?: (id: number, before: Row, after: Row, ctx: Ctx) => Promise<void>;
  /** anti-IDOR : la ligne est-elle accessible par cet utilisateur ? (ex. rattachement patient) */
  access?: (row: Row, ctx: Ctx) => Promise<boolean> | boolean;
  /** contexte supplémentaire (ex. scope patient/category) */
  baseWhere?: (ctx: Ctx) => WhereCond[];
  bump?: string[];
}

const SECRET_RE = /_hash|password|secret|totp/i;
export function sanitizeRow(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (SECRET_RE.test(k)) continue;
    out[k] = v;
  }
  return out;
}

function allCols(table: string): Set<string> {
  return new Set(tableMeta(table).writable);
}

async function buildQuery(ctx: Ctx, cfg: CrudConfig) {
  const p = paginationZ.parse(Object.fromEntries(ctx.query.entries()));
  const cols = allCols(cfg.table);
  const where: WhereCond[] = [...(cfg.baseWhere?.(ctx) ?? [])];
  const filtersRaw = ctx.query.get('filters');
  let combinator: 'AND' | 'OR' = 'AND';
  let advanced: WhereCond[] = [];
  if (filtersRaw) {
    try {
      const g = filterGroupZ.parse(JSON.parse(filtersRaw));
      advanced = g.items.filter((f) => cols.has(f.field)).map((f) => ({ field: f.field, op: f.op, value: f.value, value2: f.value2 }));
      if (g.combinator === 'OR' && advanced.length) {
        combinator = 'OR';
      } else {
        where.push(...advanced);
        advanced = [];
      }
    } catch {
      throw new ApiError(400, 'errors.validation', 'filtres invalides');
    }
  }
  if (cfg.softDelete) {
    if (p.scope === 'active') where.push({ field: 'archived_at', op: 'isNull' });
    else if (p.scope === 'archived') where.push({ field: 'archived_at', op: 'notEmpty' });
  }
  const orSearch = p.q?.trim() && cfg.search?.length ? { fields: cfg.search.filter((f) => cols.has(f)), term: p.q.trim() } : undefined;
  const sortable = cols;
  const order: [string, 'asc' | 'desc'][] = p.sortBy && sortable.has(p.sortBy) ? [[p.sortBy, p.sortDir]] : [cfg.defaultSort ?? ['id', 'desc']];
  return { p, where, combinator, advanced, orSearch, order };
}

function toCsv(rows: Row[], columns: string[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '\uFEFF' + [columns.join(';'), ...rows.map((r) => columns.map((c) => esc(r[c])).join(';'))].join('\n');
}

async function accessOr404(cfg: CrudConfig, row: Row | null, ctx: Ctx): Promise<Row> {
  if (!row) throw notFound();
  if (cfg.access && !(await cfg.access(row, ctx))) throw notFound();
  return row;
}

export function registerCrud(cfg: CrudConfig): void {
  const { resource } = cfg;
  const bodyUpdate = cfg.bodyUpdate ?? (cfg.bodyCreate as unknown as { deepPartial?: () => z.ZodTypeAny; partial?: () => z.ZodTypeAny }).deepPartial?.() ?? (cfg.bodyCreate as unknown as z.ZodObject<z.ZodRawShape>).partial();

  const map = async (input: Record<string, unknown>, ctx: Ctx, mode: 'create' | 'update', prev?: Row): Promise<Row> => {
    const row = cfg.mapInput ? (await cfg.mapInput(input, ctx, mode, prev)) : ({ ...input } as Row);
    for (const k of Object.keys(row)) if (!allCols(cfg.table).has(k)) delete row[k];
    return row;
  };

  const finish = async (cfgBump = true) => {
    for (const t of cfg.bump ?? []) await bumpTag(t);
    if (cfgBump) await bumpTag(resource);
  };

  route({
    method: 'GET',
    path: `/${resource}/export`,
    perm: [cfg.perm, 'export'],
    async handler(ctx) {
      const { where, orSearch } = await buildQuery(ctx, cfg);
      const rows = await ctx.db.find(cfg.table, { where, orSearch, orderBy: [cfg.defaultSort ?? ['id', 'asc']], limit: 5000 });
      const colsParam = ctx.query.get('cols');
      const cols = colsParam ? colsParam.split(',').filter((c) => allCols(cfg.table).has(c)) : Object.keys(rows[0] ?? {}).filter((k) => !SECRET_RE.test(k)).slice(0, 14);
      const csv = toCsv(rows.map(sanitizeRow), cols);
      return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${resource}.csv"` } });
    },
  });

  route({
    method: 'GET',
    path: `/${resource}`,
    perm: [cfg.perm, 'view'],
    async handler(ctx) {
      const { p, where, combinator, advanced, orSearch, order } = await buildQuery(ctx, cfg);
      const db = ctx.db;
      const q = { where, combinator: combinator as 'AND' | 'OR', orSearch, orderBy: order };
      const rows = await db.find(cfg.table, { ...q, limit: p.pageSize, offset: (p.page - 1) * p.pageSize });
      const total = await db.count(cfg.table, { where, combinator, orSearch });
      const out = cfg.decorate ? await cfg.decorate(rows, ctx) : rows;
      return { rows: out.map(sanitizeRow), total, page: p.page, pageSize: p.pageSize };
    },
  });

  route({
    method: 'GET',
    path: `/${resource}/:id`,
    perm: [cfg.perm, 'view'],
    async handler(ctx) {
      const row = await ctx.db.findOne(cfg.table, { id: Number(ctx.params.id) });
      const r = await accessOr404(cfg, row, ctx);
      const out = cfg.decorate ? (await cfg.decorate([r], ctx))[0]! : r;
      return sanitizeRow(out);
    },
  });

  route({
    method: 'POST',
    path: `/${resource}`,
    perm: [cfg.perm, 'create'],
    audit: { action: `${resource}.create`, entity: cfg.table },
    async handler(ctx) {
      const input = await ctx.body(cfg.bodyCreate);
      const db = ctx.db;
      const result = await db.transaction(async (tx) => {
        let row = await map(input as Record<string, unknown>, ctx, 'create');
        if (cfg.allocateCode) {
          const code = await cfg.allocateCode(tx, row, ctx);
          if (code) row = { ...row, code };
        }
        const res = await tx.insert(cfg.table, row);
        return res.id;
      });
      ctx.resultId = result;
      const stored = (await db.findOne(cfg.table, { id: result }))!;
      if (cfg.onAfterCreate) await cfg.onAfterCreate(result, stored, ctx);
      await finish();
      return { id: result, row: sanitizeRow(stored) };
    },
  });

  route({
    method: 'PUT',
    path: `/${resource}/:id`,
    perm: [cfg.perm, 'update'],
    audit: { action: `${resource}.update`, entity: cfg.table },
    async handler(ctx) {
      const db = ctx.db;
      const id = Number(ctx.params.id);
      const before = await accessOr404(cfg, await db.findOne(cfg.table, { id }), ctx);
      const input = await ctx.body(bodyUpdate);
      const patch = await map(input as Record<string, unknown>, ctx, 'update', before);
      delete patch.code; // le code est immuable
      await db.update(cfg.table, id, patch);
      const after = (await db.findOne(cfg.table, { id }))!;
      ctx.resultId = id;
      if (cfg.onAfterUpdate) await cfg.onAfterUpdate(id, before, after, ctx);
      await audit({
        actorId: ctx.user?.uid ?? null,
        action: `${resource}.update`,
        entity: cfg.table,
        entityId: id,
        ip: ctx.ip,
        ua: ctx.req.headers.get('user-agent'),
        diff: shallowDiff(sanitizeRow(before) as Record<string, unknown>, sanitizeRow(after) as Record<string, unknown>),
      });
      await finish();
      return { ok: true, row: sanitizeRow(after) };
    },
  });

  route({
    method: 'DELETE',
    path: `/${resource}/:id`,
    perm: [cfg.perm, 'delete'],
    audit: { action: `${resource}.delete`, entity: cfg.table },
    async handler(ctx) {
      const db = ctx.db;
      const id = Number(ctx.params.id);
      await accessOr404(cfg, await db.findOne(cfg.table, { id }), ctx);
      if (cfg.softDelete) await db.update(cfg.table, id, { archived_at: new Date().toISOString() });
      else await db.remove(cfg.table, id);
      ctx.resultId = id;
      await finish();
      return { ok: true, soft: Boolean(cfg.softDelete) };
    },
  });

  route({
    method: 'POST',
    path: `/${resource}/:id/archive`,
    perm: [cfg.perm, 'archive'],
    audit: { action: `${resource}.archive`, entity: cfg.table },
    async handler(ctx) {
      const id = Number(ctx.params.id);
      await accessOr404(cfg, await ctx.db.findOne(cfg.table, { id }), ctx);
      await ctx.db.update(cfg.table, id, { archived_at: new Date().toISOString() });
      ctx.resultId = id;
      await finish();
      return { ok: true };
    },
  });

  route({
    method: 'POST',
    path: `/${resource}/:id/restore`,
    perm: [cfg.perm, 'archive'],
    audit: { action: `${resource}.restore`, entity: cfg.table },
    async handler(ctx) {
      const id = Number(ctx.params.id);
      await accessOr404(cfg, await ctx.db.findOne(cfg.table, { id }), ctx);
      await ctx.db.update(cfg.table, id, { archived_at: null });
      ctx.resultId = id;
      await finish();
      return { ok: true };
    },
  });

  if (cfg.activeCol) {
    route({
      method: 'POST',
      path: `/${resource}/:id/toggle-active`,
      perm: [cfg.perm, 'update'],
      audit: { action: `${resource}.toggle`, entity: cfg.table },
      async handler(ctx) {
        const id = Number(ctx.params.id);
        const row = await accessOr404(cfg, await ctx.db.findOne(cfg.table, { id }), ctx);
        const next = row[cfg.activeCol as string] ? 0 : 1;
        await ctx.db.update(cfg.table, id, { [cfg.activeCol as string]: next } as Row);
        ctx.resultId = id;
        await finish();
        return { ok: true, active: Boolean(next) };
      },
    });
  }

  const bulkZ = z.object({
    action: z.enum(['archive', 'restore', 'delete', 'activate', 'deactivate']),
    ids: z.array(z.number().int().positive()).min(1).max(200),
  });
  route({
    method: 'POST',
    path: `/${resource}/bulk`,
    perm: [cfg.perm, 'update'],
    audit: { action: `${resource}.bulk`, entity: cfg.table },
    async handler(ctx) {
      const { action, ids } = await ctx.body(bulkZ);
      const db = ctx.db;
      let n = 0;
      for (const id of ids) {
        const row = await db.findOne(cfg.table, { id });
        if (!row) continue;
        if (cfg.access && !(await cfg.access(row, ctx))) continue;
        switch (action) {
          case 'archive':
            if (cfg.softDelete) await db.update(cfg.table, id, { archived_at: new Date().toISOString() });
            break;
          case 'restore':
            if (cfg.softDelete) await db.update(cfg.table, id, { archived_at: null });
            break;
          case 'delete':
            if (cfg.softDelete) await db.update(cfg.table, id, { archived_at: new Date().toISOString() });
            else await db.remove(cfg.table, id);
            break;
          case 'activate':
            if (cfg.activeCol) await db.update(cfg.table, id, { [cfg.activeCol]: 1 });
            break;
          case 'deactivate':
            if (cfg.activeCol) await db.update(cfg.table, id, { [cfg.activeCol]: 0 });
            break;
        }
        n++;
      }
      await finish();
      return { ok: true, applied: n };
    },
  });
}
