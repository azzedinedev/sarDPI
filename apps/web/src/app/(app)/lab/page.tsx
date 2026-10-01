'use client';
/**
 * Laboratoire (référentiel) — panneaux d’analyses et paramètres biologiques rattachés :
 * unités, bornes de référence (avec sexe/âge applicables) et seuils critiques → drapeaux H/L/N
 * calculés serveur à la saisie des résultats de fiche.
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Badge, Tabs } from '@/components/ui';
import { CrudModule, fmtVal } from '@/components/crud';
import { useAuth } from '@/stores/auth';

export default function LabPage(): React.ReactElement {
  const { t } = useT('lab');
  const [tab, setTab] = useState('panels');
  return (
    <div className="flex flex-col gap-3">
      <Tabs active={tab} onChange={setTab} tabs={[{ key: 'panels', label: t('panels') }, { key: 'params', label: t('parameters') }]} />
      {tab === 'panels' ? <PanelsTab /> : <ParamsTab />}
    </div>
  );
}

function PanelsTab(): React.ReactElement {
  const { t } = useT('lab');
  const { t: tc } = useT('common');
  const has = useAuth((s) => s.has);
  return (
    <CrudModule
      resource="lab-panels"
      title={t('panels')}
      subtitle={t('panelsHint')}
      canCreate={has('lab', 'create')}
      canArchive={false}
      canExport={false}
      defaultSort={{ id: 'code', desc: false }}
      cardTitle={(r) => fmtVal((r.name_json as Record<string, string>)?.fr ?? r.code)}
      cardSubtitle={(r) => <span className="font-mono">{fmtVal(r.code)}</span>}
      columns={[
        { key: 'code', label: tc('code'), sortable: true, width: '150px', render: (r) => <span dir="ltr" className="font-mono text-[12.5px] font-bold">{fmtVal(r.code)}</span> },
        {
          key: 'name',
          label: tc('title'),
          render: (r) => {
            const n = r.name_json as Record<string, string> | undefined;
            return (
              <span className="font-semibold">
                {n?.fr ?? fmtVal(r.name)} {n?.ar ? <span dir="rtl" className="ms-1 text-[11.5px] text-[rgb(var(--c-muted))]">{n.ar}</span> : null}
              </span>
            );
          },
        },
        { key: 'specimen', label: t('specimen'), width: '120px', render: (r) => <Badge tone="info">{fmtVal(r.specimen)}</Badge> },
        { key: 'active', label: tc('active'), width: '76px', render: (r) => (Number(r.active) === 1 ? <Badge tone="ok">✓</Badge> : <Badge>—</Badge>) },
      ]}
      fields={[
        { key: 'code', label: `${tc('code')} (NFS, IONOG…)`, required: true, hint: t('codeHint') },
        { key: 'nameFr', label: `${tc('title')} (FR)`, required: true },
        { key: 'nameAr', label: `${tc('title')} (ع)` },
        { key: 'specimen', label: t('specimen'), hint: t('specimenHint') },
        { key: 'active', label: tc('active'), kind: 'checkbox' },
      ]}
      transformCreate={(v) => ({ ...v, name: { fr: v.nameFr, ar: v.nameAr }, nameFr: undefined, nameAr: undefined })}
      transformUpdate={(v) => ({ ...v, name: { fr: v.nameFr, ar: v.nameAr }, nameFr: undefined, nameAr: undefined })}
    />
  );
}

function ParamsTab(): React.ReactElement {
  const { t } = useT('lab');
  const { t: tc } = useT('common');
  const has = useAuth((s) => s.has);
  const panels = useQuery({ queryKey: ['lab-panels-lite'], queryFn: () => api.get<{ rows: { id: number; code: string }[] }>('/lab-panels?pageSize=100') });
  const panelOpts = (panels.data?.rows ?? []).map((p) => ({ value: String(p.id), label: p.code }));
  return (
    <CrudModule
      resource="lab-parameters"
      title={t('parameters')}
      subtitle={t('paramsHint')}
      canCreate={has('lab', 'create')}
      canArchive={false}
      canExport={false}
      defaultSort={{ id: 'sort', desc: false }}
      cardTitle={(r) => fmtVal((r.name_json as Record<string, string>)?.fr ?? r.param_key)}
      cardBadges={(r) => (
        <>
          <Badge tone="info">{fmtVal(r.unit ?? '—')}</Badge>
          <Badge>{fmtVal(r.ref_min)}–{fmtVal(r.ref_max)}</Badge>
        </>
      )}
      columns={[
        { key: 'panel_id', label: t('panel'), width: '110px', render: (r) => <Badge tone="info">{fmtVal(r.panel_code ?? r.panel_id)}</Badge> },
        { key: 'param_key', label: tc('code'), sortable: true, width: '130px', render: (r) => <span dir="ltr" className="font-mono text-[12.5px] font-bold">{fmtVal(r.param_key)}</span> },
        {
          key: 'name',
          label: tc('title'),
          render: (r) => {
            const n = r.name_json as Record<string, string> | undefined;
            return <span className="font-semibold">{n?.fr ?? fmtVal(r.name)}</span>;
          },
        },
        { key: 'unit', label: t('unit'), width: '90px', render: (r) => <span dir="ltr" className="font-mono text-[12px]">{fmtVal(r.unit)}</span> },
        { key: 'ref_min', label: t('refLow'), width: '76px', render: (r) => <span className="font-mono">{fmtVal(r.ref_min)}</span> },
        { key: 'ref_max', label: t('refHigh'), width: '76px', render: (r) => <span className="font-mono">{fmtVal(r.ref_max)}</span> },
        { key: 'applies_sex', label: t('appliesSex'), width: '70px', hideByDefault: true },
        { key: 'age_min', label: t('ageMin'), width: '70px', hideByDefault: true },
        { key: 'age_max', label: t('ageMax'), width: '70px', hideByDefault: true },
        { key: 'crit_low', label: t('critLow'), width: '76px', hideByDefault: true, render: (r) => (r.crit_low !== null && r.crit_low !== undefined ? <Badge tone="danger">{fmtVal(r.crit_low)}</Badge> : '—') },
        { key: 'crit_high', label: t('critHigh'), width: '76px', hideByDefault: true, render: (r) => (r.crit_high !== null && r.crit_high !== undefined ? <Badge tone="danger">{fmtVal(r.crit_high)}</Badge> : '—') },
        { key: 'sort', label: t('order'), width: '60px', hideByDefault: true },
      ]}
      filterFields={[{ field: 'panel_id', label: t('panel'), kind: 'select', options: panelOpts }]}
      fields={[
        { key: 'panelId', label: t('panel'), kind: 'select', options: panelOpts, required: true },
        { key: 'paramKey', label: `${tc('code')} (hgb, nat)`, required: true, hint: t('paramKeyHint') },
        { key: 'nameFr', label: `${tc('title')} (FR)`, required: true },
        { key: 'nameAr', label: `${tc('title')} (ع)` },
        { key: 'unit', label: t('unit'), hint: t('unitHint') },
        { key: 'refMin', label: t('refLow'), kind: 'number', step: 'any' },
        { key: 'refMax', label: t('refHigh'), kind: 'number', step: 'any' },
        { key: 'appliesSex', label: t('appliesSex'), kind: 'select', options: [{ value: '', label: t('both') }, { value: 'M', label: 'M' }, { value: 'F', label: 'F' }] },
        { key: 'ageMin', label: t('ageMin'), kind: 'number', min: 0, max: 130 },
        { key: 'ageMax', label: t('ageMax'), kind: 'number', min: 0, max: 130 },
        { key: 'critLow', label: t('critLow'), kind: 'number', step: 'any' },
        { key: 'critHigh', label: t('critHigh'), kind: 'number', step: 'any' },
        { key: 'sort', label: t('order'), kind: 'number', min: 0, max: 999 },
      ]}
      transformCreate={(v) => toParam(v)}
      transformUpdate={(v) => toParam(v)}
    />
  );
}

function toParam(v: Record<string, unknown>): Record<string, unknown> {
  const num = (x: unknown): number | null => (x === '' || x === null || x === undefined ? null : Number(x));
  return {
    panelId: Number(v.panelId),
    paramKey: v.paramKey,
    name: { fr: v.nameFr, ar: v.nameAr },
    unit: v.unit || null,
    refMin: num(v.refMin),
    refMax: num(v.refMax),
    critLow: num(v.critLow),
    critHigh: num(v.critHigh),
    appliesSex: v.appliesSex || null,
    ageMin: num(v.ageMin),
    ageMax: num(v.ageMax),
    sort: num(v.sort) ?? 0,
  };
}
