/**
 * CATALOGUE CONFIGURABLE — catégories médicales (avec préfixes de code) et types d'intervention.
 * Tout est administrable SANS CODE : libellés multilingues, champs personnalisés, vues, statuts, modèle PDF.
 * Règles : préfixe unique 2-5 lettres majuscules ; immuabilité des codes déjà utilisés non touchée
 * (un type modifié ne réécrit pas les codes existants).
 */
import { z } from 'zod';
import { interventionTypeBaseZ, isValidPrefix, DEFAULT_CATEGORIES, DEFAULT_GED_TYPES } from '@sardpi/shared';
import { route } from '../http/router';
import { registerCrud } from '../http/crud';
import { ApiError } from '../http/errors';
import { getDb } from '../data';
import { bumpTag } from '../cache';
import { getSection, saveSection } from '../settings';

export function registerCatalog(): void {
  /* ---------------------------------------------------------- catégories */
  const categoryZ = z.object({
    prefix: z.string().regex(/^[A-Z]{2,5}$/),
    module: z.string().regex(/^[a-z][a-z0-9_]{1,25}$/),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#0ea5b7'),
    icon: z.string().regex(/^[a-z][a-z0-9-]{1,30}$/).default('flask'),
    label: z.record(z.string().max(80)).refine((v) => Object.values(v).some((s) => s?.trim()), 'label requis'),
    active: z.coerce.boolean().default(true),
  });

  registerCrud({
    resource: 'categories',
    table: 'intervention_categories',
    perm: 'category',
    search: ['prefix', 'module'],
    defaultSort: ['prefix', 'asc'],
    bodyCreate: categoryZ,
    bodyUpdate: categoryZ.partial(),
    mapInput: async (i) => ({
      code: String(i.prefix), // code = préfixe (unique)
      prefix: i.prefix,
      module: i.module,
      color: i.color,
      icon: i.icon,
      label_json: i.label,
      active: i.active === false ? 0 : 1,
    }),
    bump: ['refs'],
  });

  route({
    method: 'POST',
    path: '/categories/check',
    perm: ['category', 'create'],
    async handler(ctx) {
      const input = await ctx.body(z.object({ prefix: z.string(), module: z.string() }));
      const ok = isValidPrefix(input.prefix);
      const db = ctx.db;
      const exists = !!(await db.findOne('intervention_categories', { prefix: input.prefix.toUpperCase() }));
      const existsModule = !!(await db.findOne('intervention_categories', { module: input.module }));
      return { valid: ok, available: !exists && !existsModule, takenPrefix: exists, takenModule: existsModule };
    },
  });

  /* -------------------------------------------------- types d'intervention */
  registerCrud({
    resource: 'intervention-types',
    table: 'intervention_types',
    perm: 'interventionType',
    search: ['code', 'type_code'],
    defaultSort: ['category_prefix', 'asc'],
    softDelete: true,
    activeCol: 'active',
    bodyCreate: interventionTypeBaseZ,
    bodyUpdate: interventionTypeBaseZ.partial(),
    mapInput: async (i) => {
      const db = await getDb();
      const cat = await db.findOne<Record<string, unknown>>('intervention_categories', { prefix: String(i.categoryPrefix) });
      if (!cat) throw new ApiError(400, 'errors.validation', 'catégorie inconnue', { categoryPrefix: true });
      const dup = await db.findOne('intervention_types', { category_prefix: String(i.categoryPrefix), type_code: String(i.code) });
      if (dup) throw new ApiError(409, 'errors.conflict', 'type déjà défini pour cette catégorie', { code: true });
      return {
        code: `${i.categoryPrefix}_${i.code}`,
        category_prefix: i.categoryPrefix,
        type_code: i.code,
        name_json: i.name,
        description_json: i.description ?? null,
        fields_json: i.fields ?? [],
        statuses_json: i.statuses ?? [],
        default_status: i.defaultStatus,
        views_json: i.views ?? {},
        pdf_template: i.pdfTemplate,
        require_verify_token: i.requireVerifyToken ? 1 : 0,
        active: i.active === false ? 0 : 1,
      };
    },
    bump: ['refs'],
  });

  /* ------------------------------------------------- préfixes GED / praticiens (admin) */
  route({
    method: 'GET',
    path: '/admin/ged-types',
    perm: ['setting', 'view'],
    async handler() {
      const st = (await getSection('gedTypes')) as { types: { prefix: string; path: string; label: Record<string, string> }[] };
      return { types: st.types, defaults: DEFAULT_GED_TYPES };
    },
  });

  route({
    method: 'PUT',
    path: '/admin/ged-types',
    perm: ['setting', 'update'],
    audit: { action: 'settings.gedTypes', entity: 'settings' },
    async handler(ctx) {
      const input = await ctx.body(z.object({ types: z.array(z.object({ prefix: z.string().regex(/^[A-Z]{2,5}$/), path: z.string().regex(/^[a-z0-9_-]{1,30}$/), label: z.record(z.string().max(80)) })).max(40) }));
      const seen = new Set<string>();
      for (const t of input.types) {
        if (seen.has(t.prefix)) throw new ApiError(400, 'errors.validation', 'préfixe GED dupliqué', { prefix: t.prefix });
        seen.add(t.prefix);
      }
      await saveSection('gedTypes', { types: input.types }, ctx.user!.uid);
      await bumpTag('refs');
      return { ok: true, types: input.types };
    },
  });

  route({
    method: 'PUT',
    path: '/admin/practitioner-types',
    perm: ['setting', 'update'],
    audit: { action: 'settings.practitionerTypes', entity: 'settings' },
    async handler(ctx) {
      const input = await ctx.body(z.object({ types: z.array(z.object({ prefix: z.string().regex(/^[A-Z]{2,5}$/), label: z.record(z.string().max(80)) })).max(40) }));
      const seen = new Set<string>();
      for (const t of input.types) {
        if (seen.has(t.prefix)) throw new ApiError(400, 'errors.validation', 'préfixe intervenant dupliqué', { prefix: t.prefix });
        seen.add(t.prefix);
      }
      await saveSection('practitionerTypes', { types: input.types }, ctx.user!.uid);
      await bumpTag('refs');
      return { ok: true, types: input.types };
    },
  });

  /** Catalogue léger pour l'UI : catégories actives + types groupés. */
  route({
    method: 'GET',
    path: '/refs/catalog',
    cacheable: true,
    auth: true,
    async handler(ctx) {
      const db = ctx.db;
      const cats = await db.find<Record<string, unknown>>('intervention_categories', { where: { active: 1 }, orderBy: [['id', 'asc']] });
      const types = await db.find<Record<string, unknown>>('intervention_types', { where: { active: 1 }, orderBy: [['id', 'asc']] });
      return { categories: cats, types };
    },
  });

  /** Référentiels médicaux configurables : groupes sanguins + caisses SS (Réglages › medicalRefs). */
  route({
    method: 'GET',
    path: '/refs/medical',
    auth: true,
    licenseFree: true,
    async handler() {
      const { getSection } = await import('../settings');
      const cfg = (await getSection('medicalRefs')) as { bloodGroups: { code: string; label: Record<string, string>; active?: boolean }[]; ssFunds: { code: string; label: Record<string, string>; active?: boolean }[] };
      const on = <T extends { active?: boolean }>(xs: T[]): T[] => xs.filter((x) => x.active !== false);
      return { bloodGroups: on(cfg.bloodGroups ?? []), ssFunds: on(cfg.ssFunds ?? []) };
    },
  });

  /** Pays disponibles = profils déposés dans /country-profiles (aucune donnée personnelle). */
  route({
    method: 'GET',
    path: '/refs/countries',
    auth: false,
    licenseFree: true,
    cacheable: true,
    async handler() {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const { paths } = await import('../config');
      const dir = paths.countryProfiles;
      const out: { code: string; name: Record<string, string> }[] = [];
      try {
        for (const f of fs.readdirSync(dir)) {
          if (!f.endsWith('.json') || f.startsWith('_')) continue;
          try {
            const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { code?: string; enabled?: boolean; name?: Record<string, string> };
            if (j.enabled === false || !j.code) continue;
            out.push({ code: String(j.code).toUpperCase(), name: j.name ?? { fr: j.code.toUpperCase() } });
          } catch { /* profil invalide → ignoré (sans impact) */ }
        }
      } catch { /* pas de dossier profils → liste vide */ }
      out.sort((a, b) => a.code.localeCompare(b.code));
      return { countries: out };
    },
  });

  /** Wilayas / régions (référentiel importable — cache + ETag). */
  route({
    method: 'GET',
    path: '/refs/regions',
    cacheable: true,
    auth: false,
    licenseFree: true,
    async handler(ctx) {
      const db = ctx.db;
      const kind = ctx.query.get('kind') ?? 'wilaya';
      const rows = await db.find<Record<string, unknown>>('admin_regions', { where: { kind, active: 1 }, orderBy: [['code_str', 'asc']], limit: 2000 });
      return { rows: rows.map((r) => ({ code: r.code_str, fr: r.name_fr, ar: r.name_ar, parent: r.parent_id })) };
    },
  });

  void DEFAULT_CATEGORIES;
}
