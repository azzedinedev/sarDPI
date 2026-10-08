/**
 * CATALOGUE CONFIGURABLE — catégories médicales (avec préfixes de code) et types d'intervention.
 * Tout est administrable SANS CODE : libellés multilingues, champs personnalisés, vues, statuts, modèle PDF.
 * Règles : préfixe unique 2-5 lettres majuscules ; immuabilité des codes déjà utilisés non touchée
 * (un type modifié ne réécrit pas les codes existants).
 */
import { z } from 'zod';
import { interventionTypeBaseZ, isValidPrefix, DEFAULT_CATEGORIES, DEFAULT_GED_TYPES, pickLabel } from '@sardpi/shared';
import { route, type Ctx } from '../http/router';
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
      let types = await db.find<Record<string, unknown>>('intervention_types', { where: { active: 1 }, orderBy: [['id', 'asc']] });

      // Auto-amorçage des types de laboratoire si aucun type n'a été créé pour LAB
      const hasLab = types.some((t) => String(t.category_prefix) === 'LAB');
      if (!hasLab) {
        const DEFAULT_LAB_TYPES = [
          {
            code: 'LAB_bio', category_prefix: 'LAB', type_code: 'bio',
            name_json: { fr: 'Bilan biologique courant', ar: 'الكيمياء الحيوية العامة', es: 'Bioquímica clínica', en: 'Routine biochemistry' },
            fields_json: [
              { key: 'prelevement_at', kind: 'datetime', label: { fr: 'Date & heure de prélèvement', ar: 'تاريخ ووقت أخذ العينة' }, required: true },
              { key: 'sample_type', kind: 'select', label: { fr: 'Nature de l’échantillon', ar: 'نوع العيّنة' }, options: ['Sang veineux', 'Sang artériel', 'Urines', 'Autre'] },
              { key: 'indication', kind: 'text', label: { fr: 'Indication clinique', ar: 'دواعي الفحص' } },
              { key: 'conclusion', kind: 'textarea', label: { fr: 'Interprétation / Conclusion', ar: 'الخلاصة والتفسير' }, required: true },
            ],
            statuses_json: ['draft', 'in_progress', 'validated', 'cancelled'], default_status: 'draft',
            pdf_template: 'report', active: 1, require_verify_token: 1, views_json: { formColumns: 2, listColumns: [] },
          },
          {
            code: 'LAB_nfs', category_prefix: 'LAB', type_code: 'nfs',
            name_json: { fr: 'Hémogramme complet (NFS)', ar: 'تحليل الدم الشامل (NFS)', es: 'Hemograma completo', en: 'Complete blood count (CBC)' },
            fields_json: [
              { key: 'prelevement_at', kind: 'datetime', label: { fr: 'Date & heure de prélèvement', ar: 'تاريخ ووقت أخذ العينة' }, required: true },
              { key: 'tube', kind: 'select', label: { fr: 'Tube de prélèvement', ar: 'أنبوب العينة' }, options: ['EDTA (violet)', 'Citrate (bleu)', 'Héparine (vert)', 'Sec (rouge)'] },
              { key: 'indication', kind: 'text', label: { fr: 'Indication clinique', ar: 'دواعي الفحص' } },
              { key: 'conclusion', kind: 'textarea', label: { fr: 'Interprétation / Conclusion', ar: 'الخلاصة والتفسير' }, required: true },
            ],
            statuses_json: ['draft', 'in_progress', 'validated', 'cancelled'], default_status: 'draft',
            pdf_template: 'report', active: 1, require_verify_token: 1, views_json: { formColumns: 2, listColumns: [] },
          },
          {
            code: 'LAB_urines', category_prefix: 'LAB', type_code: 'urines',
            name_json: { fr: 'Analyse d’urines & ECBU', ar: 'تحليل البول والمزرعة الجرثومية', es: 'Urocultivo y sedimento', en: 'Urinalysis & culture' },
            fields_json: [
              { key: 'mode_recueil', kind: 'select', label: { fr: 'Mode de recueil', ar: 'طريقة الجمع' }, options: ['Milieu de jet', 'Sondage vésical', 'Poche pédiatrique'] },
              { key: 'aspect', kind: 'text', label: { fr: 'Aspect macroscopique', ar: 'المظهر العياني' } },
              { key: 'conclusion', kind: 'textarea', label: { fr: 'Conclusion', ar: 'الخلاصة' }, required: true },
            ],
            statuses_json: ['draft', 'in_progress', 'validated', 'cancelled'], default_status: 'draft',
            pdf_template: 'report', active: 1, require_verify_token: 1, views_json: { formColumns: 2, listColumns: [] },
          },
          {
            code: 'LAB_serologie', category_prefix: 'LAB', type_code: 'serologie',
            name_json: { fr: 'Sérologie & Immunologie', ar: 'علم الأمصال والمناعة', es: 'Serología e inmunología', en: 'Serology & immunology' },
            fields_json: [
              { key: 'technique', kind: 'text', label: { fr: 'Technique / Automate', ar: 'التقنية المستخدمة' } },
              { key: 'indication', kind: 'text', label: { fr: 'Indication', ar: 'دواعي الفحص' } },
              { key: 'conclusion', kind: 'textarea', label: { fr: 'Résultats & Conclusion', ar: 'النتائج والخلاصة' }, required: true },
            ],
            statuses_json: ['draft', 'in_progress', 'validated', 'cancelled'], default_status: 'draft',
            pdf_template: 'report', active: 1, require_verify_token: 1, views_json: { formColumns: 2, listColumns: [] },
          },
          {
            code: 'LAB_coag', category_prefix: 'LAB', type_code: 'coag',
            name_json: { fr: 'Hémostase & Coagulation (TP / INR / TCA)', ar: 'تخثر الدم والسيولة', es: 'Coagulación y hemostasia', en: 'Hemostasis & coagulation' },
            fields_json: [
              { key: 'traitement', kind: 'text', label: { fr: 'Traitement anticoagulant', ar: 'العلاج بمضادات التخثر' } },
              { key: 'conclusion', kind: 'textarea', label: { fr: 'Interprétation', ar: 'التفسير' }, required: true },
            ],
            statuses_json: ['draft', 'in_progress', 'validated', 'cancelled'], default_status: 'draft',
            pdf_template: 'report', active: 1, require_verify_token: 1, views_json: { formColumns: 2, listColumns: [] },
          },
        ];
        for (const lt of DEFAULT_LAB_TYPES) {
          const inserted = await db.insert('intervention_types', lt);
          types.push(inserted);
        }
      }

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
  // Préférences d'affichage (formats de date, libellés des étapes du suivi) — non-PHI.
  route({
    method: 'GET',
    path: '/refs/display',
    auth: true,
    licenseFree: true,
    async handler(ctx: Ctx) {
      const general = await getSection('general');
      const wf = (await getSection('workflowSteps')) as unknown as { steps?: { key: string; order?: number; label?: Record<string, string> }[] };
      // Étiquettes du calendrier (types + statuts) — libellés déjà localisés ici : la route
      // publique de lecture ne doit pas exiger la permission « setting:view ».
      const cal = (await getSection('calendarKinds')) as unknown as {
        kinds?: { key: string; order?: number; color?: string; durationMin?: number; active?: boolean; label?: Record<string, string> }[];
        statuses?: { key: string; order?: number; color?: string; label?: Record<string, string> }[];
      };
      const lang = ctx.user?.locale ?? 'fr';
      const byOrder = (a: { order?: number }, b: { order?: number }): number => (a.order ?? 0) - (b.order ?? 0);
      return {
        ok: true,
        dateDisplay: (general as { dateDisplay?: string }).dateDisplay ?? 'DD/MM/YYYY',
        timeDisplay: (general as { timeDisplay?: boolean }).timeDisplay !== false,
        steps: [...(wf.steps ?? [])].sort(byOrder).map((s) => ({ key: s.key, label: s.label?.[lang] ?? s.label?.fr ?? s.key })),
        calendarKinds: {
          kinds: [...(cal.kinds ?? [])].filter((k) => k.active !== false).sort(byOrder).map((k) => ({ key: k.key, label: k.label?.[lang] ?? k.label?.fr ?? k.key, color: k.color ?? '#3b82f6', durationMin: k.durationMin ?? 30 })),
          statuses: [...(cal.statuses ?? [])].sort(byOrder).map((s) => ({ key: s.key, label: s.label?.[lang] ?? s.label?.fr ?? s.key, color: s.color ?? '#64748b' })),
        },
      };
    },
  }),
  // Libellés des préfixes de codes métier (LAB, CAR, ORD, PAT, MOV…) — infobulles côté client.
  route({
    method: 'GET',
    path: '/refs/prefixes',
    auth: true,
    licenseFree: true,
    async handler(ctx: Ctx) {
      const db = ctx.db;
      const lang = ctx.user?.locale ?? 'fr';
      const out: Record<string, string> = {};
      try {
        const cats = await db.find<Record<string, unknown>>('intervention_categories', {});
        for (const c of cats) out[String(c.prefix)] = pickLabel((c.label_json ?? {}) as Record<string, string>, lang) ?? String(c.prefix);
      } catch {
        /* table absente (mini-JSON sans seed) — préfixes supplémentaires ci-dessous */
      }
      const ged = (await getSection('gedTypes')) as unknown as { types?: { prefix: string; label?: Record<string, string> }[] };
      for (const t of ged.types ?? []) if (t.label) out[t.prefix] = t.label[lang] ?? t.label.fr ?? t.prefix;
      const pra = (await getSection('practitionerTypes')) as unknown as { types?: { prefix: string; label?: Record<string, string> }[] };
      for (const t of pra.types ?? []) if (t.label) out[t.prefix] = t.label[lang] ?? t.label.fr ?? t.prefix;
      const extra: Record<string, [string, string, string, string]> = {
        PAT: ['Fiche patient (code patient)', 'بطاقة المريض', 'Ficha de paciente', 'Patient record code'],
        ORD: ['Ordonnance', 'وصفة طبية', 'Prescripción', 'Prescription'],
        MOV: ['Mouvement / transfert du patient', 'تنقل المريض', 'Desplazamiento del paciente', 'Patient movement'],
        RDV: ['Rendez-vous', 'موعد', 'Cita', 'Appointment'],
        CAS: ['Dossier de suivi (workflow)', 'ملف المتابعة', 'Expediente de seguimiento', 'Care record'],
        LOC: ['Emplacement (lit, salle, service)', 'موقع', 'Ubicación', 'Location'],
        MSG: ['Message interne', 'رسالة داخلية', 'Mensaje interno', 'Internal message'],
        GED: ['Document (GED)', 'وثيقة', 'Documento', 'Document'],
        DRG: ['Médicament du catalogue', 'دواء', 'Medicamento', 'Catalog drug'],
      };
      for (const [p, v] of Object.entries(extra)) if (!out[p]) out[p] = lang === 'ar' ? v[1] : lang === 'es' ? v[2] : lang === 'en' ? v[3] : v[0];
      return { ok: true, prefixes: out };
    },
  }),
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
