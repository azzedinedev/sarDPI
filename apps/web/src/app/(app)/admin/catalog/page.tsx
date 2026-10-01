'use client';
/**
 * Catalogue des interventions (§8.4) — CATÉGORIES (préfixe, module de permission, couleur, icône)
 * et TYPES (champs du formulaire, vues, statuts, modèle PDF) : TOUT est en base, aucun code
 * n’est nécessaire pour ajouter « Échographie cardiaque fœtale » ou une nouvelle spécialité.
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Blocks, ClipboardList } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Badge, Tabs } from '@/components/ui';
import { BizCode } from '@/components/biz-code';
import { CrudModule, fmtVal } from '@/components/crud';
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
      cardBadges={(r) => <Badge style-ignore={undefined}>{fmtVal(r.module)}</Badge>}
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
      detail={(r) => (
        <div className="flex flex-col gap-2">
          <Blocks size={16} className="text-[rgb(var(--c-muted))]" />
          <p dir="ltr" className="max-h-72 overflow-auto rounded-xl bg-[rgb(var(--c-surface-2))] p-3 font-mono text-[11px]">
            {JSON.stringify({ fields: r.fields_json, statuses: r.statuses_json, views: r.views_json, pdf: r.pdf_template }, null, 2)}
          </p>
        </div>
      )}
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
