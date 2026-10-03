'use client';
/**
 * Catalogue des interventions (§8.4) — CATÉGORIES (préfixe, module de permission, couleur, icône)
 * et TYPES (champs du formulaire, vues, statuts, modèle PDF) : TOUT est en base, aucun code
 * n’est nécessaire pour ajouter « Échographie cardiaque fœtale » ou une nouvelle spécialité.
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import { Blocks, ChevronDown, ClipboardList } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n, useT } from '@/lib/i18n';
import { Badge, Button, Tabs } from '@/components/ui';
import { BizCode } from '@/components/biz-code';
import { CrudModule, fmtVal } from '@/components/crud';
import { ValueView } from '@/components/value-view';
import { useAuth } from '@/stores/auth';
import { interventionTypeBaseZ, pickLabel } from '@sardpi/shared';

export default function AdminCatalogPage(): React.ReactElement {
  const { t } = useT('settings');
  const [tab, setTab] = useState('categories');
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-[20px] font-bold">{t('admin.catalog')}</h1>
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'categories', label: t('catalog.categories') },
          { key: 'types', label: t('catalog.types') },
        ]}
      />
      {tab === 'categories' ? <CategoriesTab /> : <TypesTab />}
    </div>
  );
}

function CategoriesTab(): React.ReactElement {
  const { t } = useT('settings');
  const { t: tc } = useT('common');
  const has = useAuth((s) => s.has);
  return (
    <CrudModule
      resource="categories"
      title={t('catalog.categories')}
      subtitle={t('catalog.catsHint')}
      canCreate={has('catalog', 'create')}
      canArchive={false}
      canExport={false}
      defaultSort={{ id: 'prefix', desc: false }}
      cardTitle={(r) => fmtVal((r.label_json as Record<string, string>)?.fr ?? r.prefix)}
      cardBadges={(r) => <Badge>{fmtVal(r.module)}</Badge>}
      columns={[
        { key: 'prefix', label: tc('code'), sortable: true, width: '90px', render: (r) => <BizCode code={fmtVal(r.prefix)} /> },
        {
          key: 'label',
          label: tc('title'),
          render: (r) => {
            const l = r.label_json as Record<string, string> | undefined;
            return <span className="font-semibold">{l?.fr ?? fmtVal(r.label)}</span>;
          },
        },
        { key: 'module', label: t('catalog.module'), width: '130px', render: (r) => <Badge tone="info">{fmtVal(r.module)}</Badge> },
        { key: 'color', label: t('catalog.color'), width: '90px', render: (r) => <span className="inline-block h-5 w-8 rounded-full border border-black/10" style={{ background: String(r.color ?? '#888') }} /> },
        { key: 'icon', label: t('catalog.icon'), width: '110px', hideByDefault: true },
        { key: 'active', label: tc('active'), width: '76px', render: (r) => (Number(r.active) === 1 ? <Badge tone="ok">✓</Badge> : <Badge>—</Badge>) },
      ]}
      fields={[
        { key: 'prefix', label: `${tc('code')} (LAB, RAD…)`, required: true },
        { key: 'module', label: t('catalog.module'), required: true, hint: t('catalog.moduleHint') },
        { key: 'labelFr', label: `${tc('title')} (FR)`, required: true },
        { key: 'labelAr', label: `${tc('title')} (ع)` },
        { key: 'color', label: t('catalog.color'), placeholder: '#0ea5b7' },
        { key: 'icon', label: t('catalog.icon'), hint: t('catalog.iconHint') },
        { key: 'active', label: tc('active'), kind: 'checkbox' },
      ]}
      transformCreate={(v) => ({ ...v, label: { fr: v.labelFr, ar: v.labelAr }, labelFr: undefined, labelAr: undefined })}
      transformUpdate={(v) => ({ ...v, label: { fr: v.labelFr, ar: v.labelAr }, labelFr: undefined, labelAr: undefined })}
    />
  );
}

function TypesTab(): React.ReactElement {
  const { t } = useT('settings');
  const { t: tc } = useT('common');
  const { lang } = useT('common');
  const has = useAuth((s) => s.has);
  const cats = useQuery({ queryKey: ['cats-lite'], queryFn: () => api.get<{ rows: { id: number; prefix: string; label_json: Record<string, string> }[] }>('/categories?pageSize=100') });
  const catOpts = (cats.data?.rows ?? []).map((c) => ({ value: c.prefix, label: `${c.prefix} — ${pickLabel(c.label_json as never, lang)}` }));
  return (
    <CrudModule
      resource="intervention-types"
      title={t('catalog.types')}
      subtitle={t('catalog.typesHint')}
      canCreate={has('catalog', 'create')}
      canArchive={false}
      canExport={false}
      defaultSort={{ id: 'code', desc: false }}
      cardTitle={(r) => fmtVal((r.name_json as Record<string, string>)?.fr ?? r.type_code)}
      cardSubtitle={(r) => <BizCode code={r.code as string} />}
      cardBadges={(r) => <Badge tone="info">{fmtVal(r.category_prefix)}</Badge>}
      columns={[
        { key: 'category_prefix', label: t('catalog.category'), width: '84px', render: (r) => <Badge tone="info">{fmtVal(r.category_prefix)}</Badge> },
        { key: 'type_code', label: tc('code'), sortable: true, width: '130px', render: (r) => <span dir="ltr" className="font-mono text-[12.5px] font-bold">{fmtVal(r.type_code)}</span> },
        {
          key: 'name',
          label: tc('title'),
          render: (r) => {
            const n = r.name_json as Record<string, string> | undefined;
            return <span className="font-semibold">{n?.fr ?? fmtVal(r.name)}</span>;
          },
        },
        { key: 'pdf_template', label: t('catalog.pdf'), width: '100px', hideByDefault: true },
        { key: 'default_status', label: t('catalog.defaultStatus'), width: '110px', hideByDefault: true },
        { key: 'fields_json', label: t('catalog.nFields'), width: '80px', render: (r) => <Badge>{Array.isArray(r.fields_json) ? (r.fields_json as unknown[]).length : 0}</Badge> },
        { key: 'active', label: tc('active'), width: '76px', render: (r) => (Number(r.active) === 1 ? <Badge tone="ok">✓</Badge> : <Badge>—</Badge>) },
      ]}
      filterFields={[{ field: 'category_prefix', label: t('catalog.category'), kind: 'select', options: catOpts }]}
      schema={interventionTypeBaseZ}
      fields={[
        { key: 'categoryPrefix', label: t('catalog.category'), kind: 'select', options: catOpts, required: true },
        { key: 'code', label: `${tc('code')} (ecg, nfs…)`, required: true },
        { key: 'nameFr', label: `${tc('title')} (FR)`, required: true },
        { key: 'nameAr', label: `${tc('title')} (ع)` },
        { key: 'defaultStatus', label: t('catalog.defaultStatus'), placeholder: 'draft' },
        { key: 'statusesCsv', label: t('catalog.statuses'), placeholder: 'draft,validated,cancelled' },
        { key: 'pdfTemplate', label: t('catalog.pdf'), kind: 'select', options: ['auto', 'report', 'lab', 'rx', 'certificate', 'none'].map((x) => ({ value: x, label: x })) },
        { key: 'formColumns', label: t('catalog.formCols'), kind: 'number', min: 1, max: 3 },
        { key: 'listColumnsCsv', label: t('catalog.listCols'), hint: t('catalog.listColsHint') },
        { key: 'fieldsJson', label: t('catalog.fields'), kind: 'json', hint: t('catalog.fieldsHint'), colSpan: 2 },
        { key: 'requireVerifyToken', label: t('catalog.verifyToken'), kind: 'checkbox' },
        { key: 'active', label: tc('active'), kind: 'checkbox' },
      ]}
      transformCreate={(v) => toType(v)}
      transformUpdate={(v) => toType(v)}
      detail={(r) => <TypeDetail row={r} />}
    />
  );
}

function toType(v: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    categoryPrefix: v.categoryPrefix,
    code: v.code,
    name: { fr: v.nameFr, ar: v.nameAr },
    defaultStatus: v.defaultStatus || 'draft',
    statuses: String(v.statusesCsv ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
    pdfTemplate: v.pdfTemplate ?? 'report',
    requireVerifyToken: Boolean(v.requireVerifyToken),
    active: v.active !== false,
    views: { formColumns: Number(v.formColumns ?? 2), listColumns: String(v.listColumnsCsv ?? '').split(',').map((x) => x.trim()).filter(Boolean) },
  };
  if (v.fieldsJson) {
    try {
      out.fields = JSON.parse(String(v.fieldsJson));
    } catch {
      out.fields = [];
    }
  }
  return out;
}

/** Ligne de configuration d'un champ de fiche (intervention_types.fields_json). */
interface FieldCfg {
  key: string;
  kind?: string;
  label?: Record<string, string> | string;
  required?: boolean;
  unit?: string;
  options?: unknown;
}

/**
 * Détail d'un TYPE d'intervention — rendu structuré à la place du bloc JSON brut.
 * Les champs deviennent un vrai tableau (clé, libellé traduit, type, obligatoire, unité, options),
 * les vues et statuts des paires clé→valeur et des puces. Le JSON reste consultable à la demande
 * (bouton « JSON brut ») : un administrateur doit pouvoir copier une configuration existante.
 */
function TypeDetail({ row }: { row: Record<string, unknown> }): React.ReactElement {
  const { t } = useT('settings');
  const { t: tc } = useT('common');
  const { lang } = useI18n();
  const reduce = useReducedMotion();
  const [raw, setRaw] = useState(false);

  const fields = (Array.isArray(row.fields_json) ? row.fields_json : []) as FieldCfg[];
  const statuses = Array.isArray(row.statuses_json) ? (row.statuses_json as unknown[]) : [];
  const views = (row.views_json ?? {}) as { formColumns?: number; listColumns?: unknown };
  const listCols = Array.isArray(views.listColumns) ? (views.listColumns as unknown[]) : [];
  const pdf = row.pdf_template ? String(row.pdf_template) : '';

  return (
    <div className="flex flex-col gap-3">
      {/* ---------------- champs du formulaire ---------------- */}
      <section className="flex flex-col gap-1.5">
        <header className="flex items-center gap-2">
          <Blocks size={15} className="text-[rgb(var(--c-primary))]" />
          <h3 className="text-[13px] font-bold">{t('catalog.fields')}</h3>
          <Badge tone="neutral">{t('catalog.nFields')} : {fields.length}</Badge>
        </header>
        {fields.length === 0 ? (
          <p className="rounded-lg bg-[rgb(var(--c-surface-2)/0.7)] px-3 py-2 text-[12.5px] text-[rgb(var(--c-muted))]">{t('catalog.noFields')}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[rgb(var(--c-line)/0.7)]">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="bg-[rgb(var(--c-surface-2)/0.85)]">
                  {[t('catalog.fieldKey'), tc('title'), t('catalog.fieldKind'), t('catalog.fieldRequired'), t('catalog.fieldUnit'), t('catalog.fieldOptions')].map((h) => (
                    <th key={h} className="px-2.5 py-1.5 text-start text-[11px] font-bold uppercase tracking-wide text-[rgb(var(--c-muted))]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fields.map((f, i) => (
                  <motion.tr
                    key={f.key}
                    className="border-t border-[rgb(var(--c-line)/0.5)] align-top odd:bg-[rgb(var(--c-surface)/0.45)]"
                    initial={{ opacity: 0, y: reduce ? 0 : 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: reduce ? 0 : 0.18, delay: reduce ? 0 : Math.min(i * 0.025, 0.25) }}
                  >
                    <td className="px-2.5 py-1.5">
                      <code dir="ltr" className="rounded bg-[rgb(var(--c-surface-2))] px-1.5 py-0.5 font-mono text-[11.5px]">
                        {f.key}
                      </code>
                    </td>
                    <td className="px-2.5 py-1.5 font-semibold">{typeof f.label === 'string' ? f.label : pickLabel((f.label ?? {}) as never, lang as never) || f.key}</td>
                    <td className="px-2.5 py-1.5">
                      <Badge tone="info">{f.kind ?? 'text'}</Badge>
                    </td>
                    <td className="px-2.5 py-1.5">{f.required ? <Badge tone="warn">{tc('yes')}</Badge> : <span className="text-[rgb(var(--c-muted)/0.6)]">—</span>}</td>
                    <td className="px-2.5 py-1.5">{f.unit ?? <span className="text-[rgb(var(--c-muted)/0.6)]">—</span>}</td>
                    <td className="max-w-[16rem] px-2.5 py-1.5">
                      <ValueView value={f.options} lang={lang} />
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---------------- vues, statuts, modèle PDF ---------------- */}
      <section className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="glass-soft flex flex-col gap-1 p-2.5">
          <span className="text-[11px] font-bold uppercase tracking-wide text-[rgb(var(--c-muted))]">{t('catalog.formCols')}</span>
          <span className="text-[15px] font-bold tabular-nums" dir="ltr">
            {views.formColumns ?? 2}
          </span>
        </div>
        <div className="glass-soft flex flex-col gap-1 p-2.5">
          <span className="text-[11px] font-bold uppercase tracking-wide text-[rgb(var(--c-muted))]">{t('catalog.listCols')}</span>
          {listCols.length ? (
            <span className="flex flex-wrap gap-1">
              {listCols.map((c, i) => (
                <code key={i} dir="ltr" className="badge font-mono">
                  {String(c)}
                </code>
              ))}
            </span>
          ) : (
            <span className="text-[12.5px] text-[rgb(var(--c-muted)/0.7)]">—</span>
          )}
        </div>
        <div className="glass-soft flex flex-col gap-1 p-2.5">
          <span className="text-[11px] font-bold uppercase tracking-wide text-[rgb(var(--c-muted))]">{t('catalog.pdf')}</span>
          <span>
            <Badge tone="neutral">{pdf || '—'}</Badge>
          </span>
        </div>
      </section>

      <section className="flex flex-col gap-1">
        <span className="text-[11px] font-bold uppercase tracking-wide text-[rgb(var(--c-muted))]">{t('catalog.statuses')}</span>
        {statuses.length ? (
          <span className="flex flex-wrap gap-1">
            {statuses.map((s, i) => (
              <span key={i} className="badge">
                {String(s)}
              </span>
            ))}
          </span>
        ) : (
          <span className="text-[12.5px] text-[rgb(var(--c-muted)/0.7)]">{t('catalog.defaultStatus')} : {String(row.default_status ?? 'draft')}</span>
        )}
      </section>

      {/* ---------------- JSON brut (à la demande) ---------------- */}
      <div className="border-t border-[rgb(var(--c-line)/0.6)] pt-2">
        <Button size="sm" variant="ghost" onClick={() => setRaw((v) => !v)} aria-expanded={raw}>
          <ChevronDown size={14} className={raw ? 'rotate-180' : ''} /> {t('catalog.rawJson')}
        </Button>
        {raw ? (
          <pre dir="ltr" className="mt-2 max-h-72 overflow-auto rounded-xl bg-[rgb(var(--c-surface-2))] p-3 font-mono text-[11px] leading-relaxed">
            {JSON.stringify({ fields: row.fields_json, statuses: row.statuses_json, views: row.views_json, pdf: row.pdf_template }, null, 2)}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
