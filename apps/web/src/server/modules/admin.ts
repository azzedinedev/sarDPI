/**
 * ADMINISTRATION — utilisateurs, rôles (matrice), paramètres typés, base de données (test/bascule/export/import),
 * éditeur de traductions (validation avant sauvegarde), thèmes (rescan/approbation/création), jobs,
 * audit (vérification de chaîne), sauvegardes, captcha, imports externes (mapping + test de connexion).
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { userCreateZ, userUpdateZ, roleUpdateZ, multiLabelZ, can, compactDate } from '@sardpi/shared';
import { route, type Ctx } from '../http/router';
import { registerCrud, sanitizeRow } from '../http/crud';
import { ApiError, notFound } from '../http/errors';
import { getDb, dbPing, reinitDb, readOverlay, writeOverlay, effectiveConfig, type DataOverlay } from '../data';
import { getAll, saveSection, SECTION_NAMES, type SectionName } from '../settings';
import { getSection } from '../settings';
import { hashPassword } from '../auth/password';
import { invalidateRoleCache } from '../auth/guard';
import { bumpTag } from '../cache';
import { verifyChain } from '../audit';
import { scanThemes, activeThemeCss, rescanThemes, approveTheme, writeTheme } from '../themes';
import { paths, env } from '../config';
import { loadNamespace, i18nHealth, getMissingKeysReport, clearMissingKeysReport, invalidateI18nCache, getLanguages } from '../i18n/server';
import { jobStats } from '../jobs';
import { getProfileByCode, listProfileCodes } from '../country';
import { encryptField } from '../security/crypto';

export function registerAdmin(): void {
  /* ---------------------------------------------------------------- users */
  registerCrud({
    resource: 'users',
    table: 'users',
    perm: 'user',
    search: ['username', 'email', 'full_name'],
    defaultSort: ['username', 'asc'],
    activeCol: 'active',
    bodyCreate: userCreateZ,
    bodyUpdate: userUpdateZ,
    async mapInput(i, _ctx, mode) {
      const out: Record<string, unknown> = {
        username: i.username,
        email: i.email,
        full_name: i.fullName,
        role_id: i.roleId,
        locale: i.locale ?? 'fr',
        active: i.active === false ? 0 : 1,
        phone: i.phone ?? null,
      };
      if (mode === 'create') {
        const db = await getDb();
        if (await db.findOne('users', { username: i.username })) throw new ApiError(409, 'errors.conflict', 'identifiant pris', { username: true });
        if (await db.findOne('users', { email: i.email })) throw new ApiError(409, 'errors.conflict', 'e-mail pris', { email: true });
        out.password_hash = await hashPassword(String(i.password ?? ''));
      } else {
        if (i.password) out.password_hash = await hashPassword(String(i.password));
      }
      return out;
    },
    bump: ['perms'],
  });

  // Réinitialisation admin d'un mot de passe : endpoint dédié (le schéma userUpdateZ ne transporte
  // jamais de mot de passe) — politique appliquée, changement forcé à la prochaine connexion, audit.
  route({
    method: 'POST',
    path: '/users/:id/reset-password',
    perm: ['user', 'update'],
    audit: { action: 'users.reset_password', entity: 'users' },
    async handler(ctx: Ctx) {
      const id = Number(ctx.params.id);
      const body = (await ctx.req.json()) as { password?: string };
      const { passwordPolicyZ } = await import('@sardpi/shared');
      const pw = passwordPolicyZ.parse(body.password);
      const db = ctx.db;
      if (!(await db.findOne('users', { id }))) throw notFound();
      await db.update('users', id, { password_hash: await hashPassword(pw), must_change_password: 1, failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() });
      return { ok: true };
    },
  });

  /* ---------------------------------------------------------------- roles */
  registerCrud({
    resource: 'roles',
    table: 'roles',
    perm: 'role',
    search: ['role_key'],
    defaultSort: ['role_key', 'asc'],
    bodyCreate: z.object({ role_key: z.string().regex(/^[a-z_]{3,40}$/), name: multiLabelZ, perms: z.array(z.string().max(60)).default([]) }),
    bodyUpdate: roleUpdateZ,
    mapInput: async (i) => ({ role_key: i.role_key ?? undefined, name_json: i.name, perms_json: i.perms }),
    async onAfterUpdate() {
      await invalidateRoleCache();
    },
    async onAfterCreate() {
      await invalidateRoleCache();
    },
    bump: ['perms'],
  });

  route({
    method: 'GET',
    path: '/admin/permissions-matrix',
    perm: ['role', 'view'],
    async handler() {
      const db = await getDb();
      const { MODULES, ACTIONS } = await import('@sardpi/shared');
      const roles = await db.find<Record<string, unknown>>('roles', { orderBy: [['id', 'asc']] });
      return {
        modules: MODULES,
        actions: ACTIONS,
        roles: roles.map((r) => ({
          id: Number(r.id),
          key: r.role_key,
          name: r.name_json,
          system: Boolean(Number(r.system)),
          perms: Array.isArray(r.perms_json) ? r.perms_json : JSON.parse(String(r.perms_json ?? '[]')),
        })),
      };
    },
  });

  /* ------------------------------------------------------------ settings */
  route({ method: 'GET', path: '/admin/settings', perm: ['setting', 'view'], handler: async () => await getAll() });
  route({
    method: 'PUT',
    path: '/admin/settings/:section',
    perm: ['setting', 'update'],
    audit: { action: 'settings.update', entity: 'settings' },
    async handler(ctx: Ctx) {
      const section = ctx.params.section as SectionName;
      if (!SECTION_NAMES.includes(section)) throw notFound();
      const raw = await ctx.req.json();
      const saved = await saveSection(section, raw as Record<string, unknown>, ctx.user!.uid);
      return { ok: true, section, value: saved };
    },
  });
  route({ method: 'GET', path: '/admin/settings/:section', perm: ['setting', 'view'], handler: async (ctx: Ctx) => await getSection(ctx.params.section as SectionName) });

  /* ------------------------------------------------------ base de données */
  route({ method: 'GET', path: '/admin/db', perm: ['setting', 'view'], handler: async () => ({ config: effectiveConfig(), overlay: readOverlay(), health: await dbPing() }) });
  route({
    method: 'POST',
    path: '/admin/db/test',
    perm: ['setting', 'update'],
    async handler(ctx: Ctx) {
      const input = await ctx.body(z.object({ adapter: z.enum(['mysql', 'postgres', 'json', 'memory']).optional(), mysql: z.record(z.unknown()).optional(), postgresUrl: z.string().max(400).optional() }));
      if (input.adapter || input.mysql || input.postgresUrl) {
        writeOverlay({ adapter: input.adapter as DataOverlay['adapter'], mysql: input.mysql as DataOverlay['mysql'], postgresUrl: input.postgresUrl });
      }
      const before = currentKind();
      await reinitDb(undefined);
      const h = await dbPing();
      if (!h.ok && before) await reinitDb(before); // rollback auto si la nouvelle config casse tout
      await bumpTag('refs');
      return h;
    },
  });
  route({
    method: 'POST',
    path: '/admin/db/migrate',
    perm: ['setting', 'update'],
    audit: { action: 'db.migrate', entity: 'settings' },
    async handler(ctx: Ctx) {
      const db = await getDb();
      if (db.demoMode) return { ok: true, note: 'Adaptateur JSON : les tables sont créées à la volée, aucune migration SQL nécessaire.' };
      // generateDDL est idempotent (IF NOT EXISTS / ADD INDEX tolérés) → sert de migration « expand only »
      const { generateDDL } = await import('../data/schema');
      const ddl = generateDDL(db.dialect ?? 'mysql');
      let applied = 0;
      let skipped = 0;
      const execRaw = (db as unknown as { execRaw: (s: string, p?: unknown[]) => Promise<unknown> }).execRaw.bind(db);
      for (const st of ddl.split(';').map((s) => s.trim()).filter((s) => s.length > 8)) {
        try {
          await execRaw(st);
          applied++;
        } catch (e) {
          const msg = (e as Error).message ?? '';
          if (/already exists|Duplicate/i.test(msg)) skipped++;
          else throw e;
        }
      }
      return { ok: true, applied, skipped };
    },
  });

  /**
   * REFORMATAGE des codes métier legacy — migration ponctuelle des anciennes bases.
   * Ancien format : {PAT}-{AAAAMMJJ}-{PREFIX}-{SEQ}  (ex. PAT-00001-20260831-ORD-01)
   * Nouveau format : {PREFIX}-{AAAAMMJJ}-{SEQ}-{PAT}  (ex. ORD-20260831-01-PAT-00001)
   * Transformation déterministe (réordonnancement des segments) ; les codes déjà conformes
   * sont ignorés ; les collisions sont signalées et sautées (jamais de réutilisation forcée).
   * dryRun=1 → aperçu du plan sans écriture. Réservé à l'admin (setting.update), audité.
   */
  route({
    method: 'POST',
    path: '/admin/codes/reformat',
    perm: ['setting', 'update'],
    audit: { action: 'codes.reformat', entity: 'settings' },
    async handler(ctx: Ctx) {
      const db = await getDb();
      const body = (await ctx.req.json().catch(() => ({}))) as { dryRun?: string | boolean };
      const dryRun = String(body?.dryRun ?? '0') === '1' || body?.dryRun === true;
      const LEGACY = /^([A-Z]{2,6}-\d{4,8})-(\d{6,8})-([A-Z]{2,5})-(\d{2,3})$/;
      const NEW_RE = /^[A-Z]{2,5}-\d{6,8}-\d{2,3}-[A-Z]{1,6}-\d{4,8}$/;
      const tables = ['medical_records', 'prescriptions'] as const;
      // tous les codes existants (pour détecter les collisions avec une cible déjà prise)
      const used = new Set<string>();
      const allRows: { table: string; id: number; code: string }[] = [];
      for (const table of tables) {
        const rows = await db.find<Record<string, unknown>>(table, { limit: 200000 });
        for (const r of rows) {
          const code = String(r.code ?? '');
          if (code) used.add(code);
          allRows.push({ table, id: Number(r.id), code });
        }
      }
      const plan: { table: string; id: number; from: string; to: string }[] = [];
      const conflicts: { table: string; id: number; from: string; to: string }[] = [];
      const reserved = new Set<string>();
      for (const row of allRows) {
        if (!row.code || NEW_RE.test(row.code)) continue; // déjà conforme
        const m = LEGACY.exec(row.code);
        if (!m) continue; // format inconnu → laissé tel quel
        const to = `${m[3]}-${m[2]}-${m[4]}-${m[1]}`;
        // collision si la cible est un code existant (autre ligne) ou déjà réservée par le plan
        if ((used.has(to) && !allRows.some((x) => x.code === to && x.id === row.id && x.table === row.table)) || reserved.has(to)) {
          conflicts.push({ table: row.table, id: row.id, from: row.code, to });
          continue;
        }
        reserved.add(to);
        plan.push({ table: row.table, id: row.id, from: row.code, to });
      }
      if (dryRun) return { ok: true, dryRun: true, count: plan.length, conflicts: conflicts.length, plan: plan.slice(0, 300), conflictList: conflicts.slice(0, 100) };
      let done = 0;
      for (const p of plan) {
        await db.update(p.table, p.id, { code: p.to });
        done++;
      }
      await bumpTag('records');
      await bumpTag('rx');
      return { ok: true, count: done, conflicts: conflicts.length, plan: plan.slice(0, 300), conflictList: conflicts.slice(0, 100) };
    },
  });

  /**
   * CODIFICATION en CRUD — une ligne par type de code : préfixe, padding, séparateur,
   * aperçu du PROCHAIN code (seq courant + 1) et compteur actuel (code_sequences, jamais caché).
   * Lecture seule pour les compteurs ; l'édition passe par PUT /admin/settings/codification.
   */
  route({
    method: 'GET',
    path: '/admin/codification/rows',
    perm: ['setting', 'view'],
    async handler() {
      const db = await getDb();
      const cod = (await getSection('codification')) as Record<string, unknown>;
      const sep = String(cod.separator ?? '-');
      const datePattern = String(cod.datePattern ?? 'YYYYMMDD');
      const patientPrefix = String(cod.patientPrefix ?? 'PAT');
      const num = (k: string, d: number): number => (typeof cod[k] === 'number' ? (cod[k] as number) : d);
      const pad = (x: number, p: number): string => String(x).padStart(p, '0');
      const seqs = await db.find<Record<string, unknown>>('code_sequences', { limit: 200000 });
      const maxSeq = (scopePrefix: string): number => {
        let m = 0;
        for (const r of seqs) if (String(r.scope ?? '').startsWith(scopePrefix)) m = Math.max(m, Number(r.last_value ?? 0));
        return m;
      };
      const sampleDate = compactDate(new Date(), env.timezone, datePattern as 'YYYYMMDD' | 'YYMMDD' | 'DDMMYYYY');
      interface Kind { kind: string; scopePrefix: string; paddingField: string; padding: number; prefixField?: string; prefix: string; dateInCode?: boolean }
      const kinds: Kind[] = [
        { kind: 'patient', scopePrefix: 'patient:', paddingField: 'patientPadding', padding: num('patientPadding', 5), prefixField: 'patientPrefix', prefix: patientPrefix },
        { kind: 'record', scopePrefix: 'record:', paddingField: 'recordSeqPadding', padding: num('recordSeqPadding', 2), prefix: 'LAB', dateInCode: true },
        { kind: 'ged', scopePrefix: 'ged:', paddingField: 'gedPadding', padding: num('gedPadding', 6), prefix: 'ANL' },
        { kind: 'practitioner', scopePrefix: 'practitioner:', paddingField: 'practitionerPadding', padding: num('practitionerPadding', 5), prefix: 'MED' },
        { kind: 'location', scopePrefix: 'location:', paddingField: 'locationPadding', padding: num('locationPadding', 3), prefix: 'LOC' },
        { kind: 'drug', scopePrefix: 'drug:', paddingField: 'patientPadding', padding: num('patientPadding', 5), prefix: 'DRG' },
        { kind: 'appointment', scopePrefix: 'appointment:', paddingField: 'genericPadding', padding: num('genericPadding', 5), prefix: 'RDV' },
        { kind: 'movement', scopePrefix: 'movement:', paddingField: 'genericPadding', padding: num('genericPadding', 5), prefix: 'MOV' },
        { kind: 'message', scopePrefix: 'message:', paddingField: 'genericPadding', padding: num('genericPadding', 5), prefix: 'MSG' },
        { kind: 'case', scopePrefix: 'case:', paddingField: 'genericPadding', padding: num('genericPadding', 5), prefix: 'CAS' },
        { kind: 'template', scopePrefix: 'template:', paddingField: 'genericPadding', padding: num('genericPadding', 5), prefix: 'TPL' },
      ];
      const rows = kinds.map((k) => {
        const cur = maxSeq(k.scopePrefix);
        const next = cur + 1;
        const nextPreview = k.dateInCode
          ? `${k.prefix}${sep}${sampleDate}${sep}${pad(next, k.padding)}${sep}${patientPrefix}${sep}${pad(1, num('patientPadding', 5))}`
          : `${k.prefix}${sep}${pad(next, k.padding)}`;
        return { kind: k.kind, prefix: k.prefix, prefixField: k.prefixField ?? null, padding: k.padding, paddingField: k.paddingField, separator: sep, datePattern: k.dateInCode ? datePattern : null, currentSeq: cur, nextPreview };
      });
      return { rows, separator: sep, datePattern, patientPrefix };
    },
  });

  route({
    method: 'POST',
    path: '/admin/db/export',
    perm: ['setting', 'update'],
    async handler(ctx: Ctx) {
      const db = await getDb();
      const anyDb = db as unknown as { dump?: () => Record<string, unknown> };
      if (typeof anyDb.dump === 'function') {
        const data = anyDb.dump();
        return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json', 'content-disposition': 'attachment; filename="sardpi-export.json"' } });
      }
      // SQL : export JSON table-par-table (portable vers adaptateur json)
      const { TABLES } = await import('../data/schema');
      const out: Record<string, { auto: number; rows: unknown[] }> = {};
      for (const t of TABLES) {
        const rows = await db.find(t.name, { limit: 100_000 });
        const maxId = rows.reduce((m, r) => Math.max(m, Number(r.id ?? 0)), 0);
        out[t.name] = { auto: maxId, rows: rows.map(sanitizeRow) };
      }
      return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json', 'content-disposition': 'attachment; filename="sardpi-export.json"' } });
    },
  });

  route({
    method: 'POST',
    path: '/admin/db/import',
    perm: ['setting', 'update'],
    audit: { action: 'db.import', entity: 'settings' },
    async handler(ctx: Ctx) {
      const db = await getDb();
      const anyDb = db as unknown as { restore?: (d: Record<string, { auto?: number; rows?: Record<string, unknown>[] }>) => Promise<void> };
      const data = (await ctx.req.json()) as Record<string, { auto?: number; rows?: Record<string, unknown>[] }>;
      if (typeof anyDb.restore !== 'function') throw new ApiError(400, 'errors.validation', 'import direct non supporté par cet adaptateur — utiliser les scripts SQL');
      await anyDb.restore(data);
      await bumpTag('refs');
      return { ok: true, tables: Object.keys(data).length };
    },
  });

  function currentKind() {
    return readOverlay().adapter ?? env.adapter;
  }

  /* ------------------------------------------------- éditeur traductions */
  route({
    method: 'GET',
    path: '/admin/translations',
    perm: ['translation', 'view'],
    async handler(ctx: Ctx) {
      const m = getLanguages();
      const lang = ctx.query.get('lang') ?? 'fr';
      const ns = ctx.query.get('ns') ?? 'common';
      const a = loadNamespace(lang, ns).data;
      const b = loadNamespace(m.fallback, ns).data;
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
      const merged = keys.map((k) => ({ key: k, [lang]: a[k] ?? '', [m.fallback]: b[k] ?? '', missing: a[k] === undefined }));
      return { lang, ns, keys: merged, namespaces: m.namespaces, languages: m.languages.map((l) => ({ code: l.code, name: l.name })) };
    },
  });

  route({
    method: 'PUT',
    path: '/admin/translations',
    perm: ['translation', 'update'],
    audit: { action: 'translations.save', entity: 'locales' },
    async handler(ctx: Ctx) {
      const input = await ctx.body(z.object({ lang: z.string().regex(/^[a-z]{2}$/), ns: z.string().regex(/^[a-z][a-z0-9_]{1,20}$/), entries: z.record(z.string(), z.string().max(600)) }));
      const m = getLanguages();
      if (!m.languages.some((l) => l.code === input.lang)) throw new ApiError(400, 'errors.validation', 'langue inconnue');
      if (!m.namespaces.includes(input.ns)) throw new ApiError(400, 'errors.validation', 'namespace inconnu');
      const dir = path.join(paths.locales, input.lang);
      const file = path.join(dir, `${input.ns}.json`);
      // VALIDATION AVANT SAUVEGARDE : JSON invalide → refusé, l'ancien reste actif.
      try {
        const json = JSON.stringify(input.entries, null, 2);
        JSON.parse(json);
        fs.mkdirSync(dir, { recursive: true });
        const tmp = file + '.tmp';
        fs.writeFileSync(tmp, json + '\n');
        fs.renameSync(tmp, file);
      } catch (e) {
        throw new ApiError(422, 'errors.validation', `fichier refusé : ${(e as Error).message}`);
      }
      invalidateI18nCache();
      return { ok: true, file: `locales/${input.lang}/${input.ns}.json` };
    },
  });

  route({ method: 'GET', path: '/admin/translations/missing', perm: ['translation', 'view'], handler: async () => ({ report: getMissingKeysReport(), health: i18nHealth() }) });
  route({ method: 'POST', path: '/admin/translations/missing/clear', perm: ['translation', 'update'], handler: async () => ((clearMissingKeysReport(), { ok: true })) });

  /* ---------------------------------------------------------------- thèmes */
  route({ method: 'GET', path: '/admin/themes', perm: ['theme', 'view'], handler: async () => await scanThemes() });
  route({ method: 'POST', path: '/admin/themes/rescan', perm: ['theme', 'update'], handler: async () => ((await rescanThemes()), await scanThemes(true)) });
  route({
    method: 'POST',
    path: '/admin/themes/activate',
    perm: ['theme', 'update'],
    audit: { action: 'themes.activate', entity: 'settings' },
    async handler(ctx: Ctx) {
      const input = await ctx.body(z.object({ name: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,40}$/) }));
      const scan = await scanThemes();
      if (!scan.themes.some((t) => t.manifest.name === input.name)) throw new ApiError(400, 'errors.validation', 'thème inconnu ou invalide');
      await saveSection('ui', { theme: input.name }, ctx.user!.uid);
      await bumpTag('themes');
      return { ok: true };
    },
  });
  route({
    method: 'POST',
    path: '/admin/themes/approve',
    perm: ['theme', 'update'],
    audit: { action: 'themes.approve', entity: 'themes' },
    async handler(ctx: Ctx) {
      const input = await ctx.body(z.object({ name: z.string().max(50), sha256: z.string().regex(/^[0-9a-f]{64}$/) }));
      await approveTheme(input.name, input.sha256);
      return { ok: true };
    },
  });
  route({
    method: 'POST',
    path: '/admin/themes',
    perm: ['theme', 'create'],
    audit: { action: 'themes.create', entity: 'themes' },
    async handler(ctx: Ctx) {
      const input = await ctx.body(z.object({ name: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,40}$/), manifest: z.record(z.unknown()), css: z.string().max(60_000).default('') }));
      try {
        const t = await writeTheme(input.name, input.manifest as Record<string, never>, input.css);
        return { ok: true, name: t.name };
      } catch (e) {
        throw new ApiError(422, 'errors.validation', (e as Error).message);
      }
    },
  });
  route({ method: 'GET', path: '/admin/themes/active-css', auth: false, licenseFree: true, cacheable: true, handler: async () => await activeThemeCss() });

  /* ----------------------------------------------------------------- jobs */
  route({
    method: 'GET',
    path: '/admin/jobs',
    perm: ['job', 'view'],
    async handler(ctx: Ctx) {
      const db = ctx.db;
      const status = ctx.query.get('status');
      const rows = await db.find<Record<string, unknown>>('jobs', { where: status ? { status } : undefined, orderBy: [['id', 'desc']], limit: 200 });
      return { rows, stats: await jobStats() };
    },
  });
  route({
    method: 'POST',
    path: '/admin/jobs/:id/retry',
    perm: ['job', 'update'],
    async handler(ctx: Ctx) {
      const db = ctx.db;
      const id = Number(ctx.params.id);
      if (!(await db.findOne('jobs', { id }))) throw notFound();
      await db.update('jobs', id, { status: 'queued', next_run_at: new Date().toISOString(), last_error: null });
      return { ok: true };
    },
  });
  route({
    method: 'POST',
    path: '/admin/jobs/purge',
    perm: ['job', 'update'],
    async handler(ctx: Ctx) {
      const n = await ctx.db.removeWhere('jobs', { status: 'done' });
      return { ok: true, removed: n };
    },
  });

  /* ---------------------------------------------------------------- audit */
  route({
    method: 'GET',
    path: '/admin/audit',
    perm: ['audit', 'view'],
    async handler(ctx: Ctx) {
      const db = ctx.db;
      const q = ctx.query.get('q');
      const rows = await db.find<Record<string, unknown>>('audit_log', {
        orSearch: q ? { fields: ['action', 'entity', 'entity_id'], term: String(q) } : undefined,
        orderBy: [['id', 'desc']],
        limit: 300,
      });
      return { rows };
    },
  });
  route({ method: 'POST', path: '/admin/audit/verify', perm: ['audit', 'view'], handler: async () => await verifyChain() });

  /* ---------------------------------------------------- sauvegarde locale */
  route({
    method: 'POST',
    path: '/admin/backup',
    perm: ['backup', 'update'],
    audit: { action: 'backup.run', entity: 'jobs' },
    async handler(ctx: Ctx) {
      const { enqueue } = await import('../jobs');
      const id = await enqueue('backup.run', {});
      ctx.resultId = id;
      return { ok: true, jobId: id };
    },
  });
  route({
    method: 'GET',
    path: '/admin/backups',
    perm: ['backup', 'view'], handler: async () => {
      try {
        const files = fs.readdirSync(paths.backups).sort().reverse().slice(0, 30);
        return { files: files.map((f) => ({ name: f, bytes: fs.statSync(path.join(paths.backups, f)).size })) };
      } catch {
        return { files: [] };
      }
    },
  });

  /* ----------------------------------------------------- imports externes */
  const sourceZ = z.object({
    name: z.string().min(2).max(80),
    kind: z.enum(['api', 'file']).default('api'),
    baseUrl: z.string().url().max(300),
    testPath: z.string().max(120).optional(),
    auth: z.object({ type: z.enum(['none', 'bearer', 'apikey']), value: z.string().max(200).optional(), header: z.string().max(60).optional() }).default({ type: 'none' }),
    mapping: z.record(z.string(), z.string().max(40)).default({}),
    active: z.coerce.boolean().default(true),
  });
  registerCrud({
    resource: 'external-sources',
    table: 'external_sources',
    perm: 'externalImport',
    search: ['name'],
    bodyCreate: sourceZ,
    bodyUpdate: sourceZ.partial(),
    mapInput: async (i) => {
      const auth = (i.auth ?? {}) as Record<string, unknown>;
      const val = auth.value ? encryptField(String(auth.value)) ?? String(auth.value) : undefined;
      return {
        name: i.name,
        kind: i.kind ?? 'api',
        base_url: i.baseUrl,
        test_path: i.testPath ?? null,
        auth_json: { type: auth.type ?? 'none', value: val },
        mapping_json: i.mapping ?? {},
        active: i.active === false ? 0 : 1,
      };
    },
    bump: ['refs'],
  });

  route({
    method: 'POST',
    path: '/external-sources/:id/test',
    perm: ['externalImport', 'update'],
    async handler(ctx: Ctx) {
      const db = ctx.db;
      const src = await db.findOne<Record<string, unknown>>('external_sources', { id: Number(ctx.params.id) });
      if (!src) throw notFound();
      const started = Date.now();
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6000); // circuit breaker : une source externe ne bloque jamais l'app
        const res = await fetch(`${String(src.base_url).replace(/\/$/, '')}${src.test_path ? String(src.test_path) : ''}`, { signal: controller.signal, headers: authHeader(src.auth_json) });
        clearTimeout(timer);
        return { ok: res.ok, status: res.status, ms: Date.now() - started };
      } catch (e) {
        return { ok: false, error: (e as Error).name === 'AbortError' ? 'timeout (6s)' : (e as Error).message, ms: Date.now() - started };
      }
    },
  });

  route({
    method: 'POST',
    path: '/external-sources/:id/run',
    perm: ['externalImport', 'create'],
    audit: { action: 'import.run', entity: 'import_runs' },
    async handler(ctx: Ctx) {
      const db = ctx.db;
      const id = Number(ctx.params.id);
      if (!(await db.findOne('external_sources', { id }))) throw notFound();
      const { enqueue } = await import('../jobs');
      const job = await enqueue('import.source', { sourceId: id, limit: Number(ctx.query.get('limit') ?? 200) });
      return { ok: true, jobId: job };
    },
  });

  /* ------------------------------------------------- divers (dashboard) */
  route({
    method: 'GET',
    path: '/dashboard',
    async handler(ctx: Ctx) {
      const db = ctx.db;
      const day = new Date();
      const from = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())).toISOString();
      const to = new Date(new Date(from).getTime() + 86_400_000).toISOString();
      const [patients, recordsToday, appts, pendingResults, messagesFailed, failedJobs] = await Promise.all([
        db.count('patients', { where: { archived_at: null } }),
        db.count('medical_records', { where: [{ field: 'created_at', op: 'gte', value: from }] }),
        db.find<Record<string, unknown>>('appointments', { where: [{ field: 'start_at', op: 'gte', value: from }, { field: 'start_at', op: 'lt', value: to }], orderBy: [['start_at', 'asc']], limit: 8 }),
        db.count('medical_records', { where: [{ field: 'status', op: 'neq', value: 'validated' }] }),
        db.count('email_messages', { where: [{ field: 'status', op: 'eq', value: 'failed' }] }),
        db.count('jobs', { where: [{ field: 'status', op: 'eq', value: 'failed' }] }),
      ]);
      // RDV du jour avec nom de patient (résolution N+1 bornée à 8 — adapter JSON sans jointures)
      const todayAppointments: { code: string | null; startsAt: string; patient: string | null; status: string | null }[] = [];
      for (const a of appts) {
        let patient: string | null = null;
        if (a.patient_id) {
          const pt = await db.findOne<Record<string, unknown>>('patients', { id: Number(a.patient_id) });
          if (pt) patient = `${String(pt.last_name ?? '')} ${String(pt.first_name ?? '')}`.trim();
        }
        todayAppointments.push({ code: (a.code as string) ?? null, startsAt: String(a.start_at), patient, status: (a.status as string) ?? null });
      }
      const recs = await db.find<Record<string, unknown>>('medical_records', { orderBy: [['id', 'desc']], limit: 6 });
      const recentRecords = recs.map((r) => ({ code: String(r.code ?? ''), title: (r.title as string) ?? null, actDate: String(r.act_date ?? ''), category: (r.category_prefix as string) ?? null }));
      let missingKeys = 0;
      try {
        const { getMissingKeysReport } = await import('../i18n/server');
        missingKeys = getMissingKeysReport().length;
      } catch {
        /* module i18n absent → 0 */
      }
      let licenseState = 'demo';
      try {
        const lic = (await getSection('license')) as { state?: string; expiresAt?: string };
        licenseState = lic?.state === 'valid' && lic.expiresAt && new Date(lic.expiresAt) < new Date() ? 'expired' : (lic?.state ?? 'demo');
      } catch {
        /* section absente */
      }
      return {
        counts: { patients, recordsToday, appointmentsToday: appts.length, messagesFailed, pendingResults },
        todayAppointments,
        recentRecords,
        alerts: { failedJobs, missingKeys, licenseState },
      };
    },
  });
}

function authHeader(auth: unknown): Record<string, string> {
  try {
    const a = typeof auth === 'string' ? JSON.parse(auth) : (auth as { type?: string; value?: string });
    if (!a?.value) return {};
    return a.type === 'apikey' ? { 'x-api-key': String(a.value) } : { authorization: `Bearer ${a.value}` };
  } catch {
    return {};
  }
}

void can;
