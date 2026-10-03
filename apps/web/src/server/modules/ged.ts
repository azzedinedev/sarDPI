/**
 * GED (§8.6) — code {PRÉFIXE_TYPE}-{6 chiffres} par type de document (types et préfixes administrables),
 * upload multipart avec MAGIC BYTES, versions numérotées `<CODE>_v2.ext`, rattachement patient/fiche,
 * tags + recherche métadonnées, téléchargement par URL SIGNÉE expirante (jamais l'id).
 * Les boutons/zones de dépôt héritent des tokens du thème actif (voir components/ged).
 */
import { z } from 'zod';
import { route, type Ctx } from '../http/router';
import { registerCrud } from '../http/crud';
import { ApiError, notFound } from '../http/errors';
import { getDb } from '../data';
import { getSection } from '../settings';
import { allocateSuffixed } from '../codes/service';
import { putFile, readFile, signedFileUrl, deleteFile } from '../storage';
import { env } from '../config';
import { bumpTag } from '../cache';
import { pushHistory } from './history';
import { sanitizeRow } from '../http/crud';

async function gedTypes(): Promise<{ prefix: string; path: string }[]> {
  const st = (await getSection('gedTypes')) as { types: { prefix: string; path: string }[] };
  return st.types ?? [];
}

/** POST multipart — création avec fichier (le champ `file` passe par sniffing magic bytes). */
export function registerGed(): void {
  route({
    method: 'POST',
    path: '/ged/upload',
    perm: ['ged', 'create'],
    audit: { action: 'ged.upload', entity: 'ged_documents' },
    async handler(ctx: Ctx) {
      const form = await ctx.req.formData();
      const get = (k: string) => (form.get(k) !== null ? String(form.get(k)) : undefined);
      const typePrefix = (get('typePrefix') ?? 'DOC').toUpperCase();
      const title = get('title') ?? 'Document';
      const patientId = get('patientId') ? Number(get('patientId')) : null;
      const recordId = get('recordId') ? Number(get('recordId')) : null;
      const caseId = get('caseId') ? Number(get('caseId')) : null;
      const tags = (get('tags') ?? '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 12);
      const note = get('note') ?? null;
      const file = form.get('file');
      if (!(file instanceof File)) throw new ApiError(400, 'errors.validation', 'fichier absent', { file: true });
      if (file.size > env.maxUploadBytes) throw new ApiError(413, 'errors.uploadTooLarge', undefined, { mb: Math.round(env.maxUploadBytes / 1024 / 1024) });
      const types = await gedTypes();
      const tdef = types.find((t) => t.prefix === typePrefix);
      if (!tdef) throw new ApiError(400, 'errors.validation', 'type de document inconnu', { typePrefix });

      const buf = Buffer.from(await file.arrayBuffer());
      const db = ctx.db;
      if (patientId && !(await db.findOne('patients', { id: patientId }))) throw new ApiError(400, 'errors.validation', 'patient inconnu', { patientId });

      const { code } = await db.transaction(async (tx) => allocateSuffixed('ged', typePrefix, tx));
      const stored = await putFile(buf, file.name, `ged/${tdef.path}`, code);
      const docFields = {
        code,
        type_prefix: typePrefix,
        patient_id: patientId,
        record_id: recordId,
        case_id: caseId,
        title,
        tags_json: tags,
        note,
        current_version: 1,
        file_name: `${code}_v1.${stored.ext}`,
        file_path: stored.storedPath.replace(stored.fileName, `${code}_v1.${stored.ext}`),
        mime: stored.mime,
        size_bytes: stored.size,
        sha256: stored.sha256,
        uploaded_by: ctx.user!.uid,
      } as Record<string, unknown>;
      const ins = await db.insert('ged_documents', docFields);
      const row = { ...docFields, ...ins } as Record<string, unknown> & { id: number };
      await db.insert('ged_versions', {
        document_id: row.id,
        version: 1,
        file_name: `${code}_v1.${stored.ext}`,
        file_path: row.file_path,
        mime: stored.mime,
        size_bytes: stored.size,
        sha256: stored.sha256,
        note: 'version initiale',
        created_by: ctx.user!.uid,
        created_at: new Date().toISOString(),
      });
      // nommage physique : on renomme pour respecter le conventionnement <CODE>_v1.ext
      const finalPath = String(row.file_path);
      if (finalPath !== stored.storedPath) {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const { paths } = await import('../config');
        const from = path.join(paths.storage, stored.storedPath);
        const to = path.join(paths.storage, finalPath);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.renameSync(from, to);
      }
      if (patientId) {
        await pushHistory(ctx.user!.uid, { patientId, kind: 'ged', refId: row.id, refCode: code, summary: { fr: `Document ajouté : ${title}`, ar: `أُضيفت وثيقة : ${title}`, en: `Document added: ${title}` }, detail: { type: typePrefix } });
      }
      ctx.resultId = row.id;
      await bumpTag('ged');
      return { ok: true, id: row.id, code };
    },
  });

  /** Nouvelle version d'un document existant. */
  route({
    method: 'POST',
    path: '/ged/:id/version',
    perm: ['ged', 'update'],
    audit: { action: 'ged.version', entity: 'ged_documents' },
    async handler(ctx: Ctx) {
      const db = ctx.db;
      const id = Number(ctx.params.id);
      const doc = await db.findOne<Record<string, unknown>>('ged_documents', { id });
      if (!doc) throw notFound();
      const form = await ctx.req.formData();
      const file = form.get('file');
      if (!(file instanceof File)) throw new ApiError(400, 'errors.validation', 'fichier absent');
      const buf = Buffer.from(await file.arrayBuffer());
      const version = Number(doc.current_version ?? 1) + 1;
      const stored = await putFile(buf, file.name, `ged/versions`, String(doc.code));
      const path = await import('node:path');
      const finalRel = path.posix.join(path.posix.dirname(String(doc.file_path)), `${doc.code}_v${version}.${stored.ext}`);
      const fs = await import('node:fs');
      const { paths } = await import('../config');
      const to = path.posix.join(paths.storage, finalRel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(path.posix.join(paths.storage, stored.storedPath), to);
      await db.insert('ged_versions', {
        document_id: id,
        version,
        file_name: path.posix.basename(finalRel),
        file_path: finalRel,
        mime: stored.mime,
        size_bytes: stored.size,
        sha256: stored.sha256,
        note: String(form.get('note') ?? '').slice(0, 240),
        created_by: ctx.user!.uid,
        created_at: new Date().toISOString(),
      });
      await db.update('ged_documents', id, { current_version: version, file_name: path.posix.basename(finalRel), file_path: finalRel, mime: stored.mime, size_bytes: stored.size, sha256: stored.sha256 });
      ctx.resultId = id;
      await bumpTag('ged');
      return { ok: true, version };
    },
  });

  /** URL signée de consultation / téléchargement (TTL court — fichiers JAMAIS accessibles par id). */
  route({
    method: 'GET',
    path: '/ged/:id/url',
    perm: ['ged', 'view'],
    async handler(ctx: Ctx) {
      const db = ctx.db;
      const id = Number(ctx.params.id);
      const doc = await db.findOne<Record<string, unknown>>('ged_documents', { id });
      if (!doc) throw notFound();
      const download = ctx.query.get('download') === '1';
      const signed = await signedFileUrl(String(doc.file_path), download ? 5 : env.signedUrlTtlMin);
      return { url: `${env.appUrl}${signed.url}${download ? '?download=1' : ''}`, relative: signed.url, expiresAt: signed.expiresAt, mime: doc.mime, name: doc.file_name };
    },
  });

  /** Versions d'un document. */
  route({
    method: 'GET',
    path: '/ged/:id/versions',
    perm: ['ged', 'view'],
    async handler(ctx: Ctx) {
      const rows = await ctx.db.find<Record<string, unknown>>('ged_versions', { where: { document_id: Number(ctx.params.id) }, orderBy: [['version', 'desc']] });
      return { rows };
    },
  });

  /** Métadonnées (titre/tags/note/rattachements) sans toucher au fichier. */
  route({
    method: 'PUT',
    path: '/ged/:id',
    perm: ['ged', 'update'],
    audit: { action: 'ged.update', entity: 'ged_documents' },
    async handler(ctx: Ctx) {
      const input = await ctx.body(z.object({ title: z.string().min(1).max(160).optional(), tags: z.array(z.string().max(30)).max(12).optional(), note: z.string().max(1000).nullable().optional(), patientId: z.number().int().nullable().optional(), recordId: z.number().int().nullable().optional() }));
      const db = ctx.db;
      const id = Number(ctx.params.id);
      if (!(await db.findOne('ged_documents', { id }))) throw notFound();
      await db.update('ged_documents', id, {
        ...(input.title ? { title: input.title } : {}),
        ...(input.tags ? { tags_json: input.tags } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.patientId !== undefined ? { patient_id: input.patientId } : {}),
        ...(input.recordId !== undefined ? { record_id: input.recordId } : {}),
      });
      ctx.resultId = id;
      await bumpTag('ged');
      return { ok: true };
    },
  });

  /** Types + compteurs pour l'arborescence de la GED. */
  route({
    method: 'GET',
    path: '/ged/meta/types',
    cacheable: true,
    async handler() {
      const st = (await getSection('gedTypes')) as { types: { prefix: string; path: string; label: Record<string, string> }[] };
      const db = await getDb();
      const docs = await db.find<Record<string, unknown>>('ged_documents', { limit: 20000 });
      const counts: Record<string, number> = {};
      for (const d of docs) counts[String(d.type_prefix)] = (counts[String(d.type_prefix)] ?? 0) + 1;
      return { types: st.types.map((t) => ({ ...t, count: counts[t.prefix] ?? 0 })) };
    },
  });

  /** CRUD « liste » standard (sans fichier) pour la recherche métadonnées. */
  registerCrud({
    resource: 'ged',
    table: 'ged_documents',
    perm: 'ged',
    softDelete: true,
    search: ['code', 'title', 'file_name'],
    defaultSort: ['id', 'desc'],
    bodyCreate: z.object({ typePrefix: z.string().regex(/^[A-Z]{2,5}$/), title: z.string().min(1).max(160), patientId: z.number().int().positive().optional().nullable(), recordId: z.number().int().positive().optional().nullable(), tags: z.array(z.string().max(30)).default([]), note: z.string().max(1000).optional().nullable() }),
    bodyUpdate: z.object({}).passthrough(),
    mapInput: async () => {
      throw new ApiError(400, 'errors.validation', 'la création GED passe par /ged/upload (fichier obligatoire)');
    },
    decorate: async (rows, ctx) => {
      const db = ctx.db;
      const st = (await getSection('gedTypes')) as { types: { prefix: string; label: Record<string, string> }[] };
      const labelBy = new Map(st.types.map((t) => [t.prefix, t.label]));
      const lang = ctx.user?.locale ?? 'fr';
      const patientIds = [...new Set(rows.map((r) => r.patient_id).filter(Boolean).map(Number))];
      const pats = patientIds.length ? await db.find<Record<string, unknown>>('patients', { where: { id: patientIds } }) : [];
      const pBy = new Map(pats.map((p) => [Number(p.id), p]));
      return rows.map((r) => ({
        ...r,
        type_label: labelBy.get(String(r.type_prefix))?.[lang] ?? labelBy.get(String(r.type_prefix))?.fr ?? r.type_prefix,
        patient_code: r.patient_id ? pBy.get(Number(r.patient_id))?.code ?? null : null,
        patient_name: r.patient_id ? `${String(pBy.get(Number(r.patient_id))?.last_name ?? '').toUpperCase()} ${pBy.get(Number(r.patient_id))?.first_name ?? ''}` : null,
      }));
    },
    bump: ['ged'],
  });
}

/** Lecture fichier (route /api/v1/files/:token) — résolue dans modules/files.ts. */
export { readFile, deleteFile, sanitizeRow };
export type { Ctx };
