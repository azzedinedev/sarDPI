'use client';
/** Lieux — cabinets, salles, blocs, laboratoires… (types configurables en admin). */
import React from 'react';
import { Badge } from '@/components/ui';
import { BizCode } from '@/components/biz-code';
import { CrudModule, fmtVal } from '@/components/crud';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/stores/auth';
import { locationBaseZ } from '@sardpi/shared';

export default function LocationsPage(): React.ReactElement {
  const { t } = useT('patient');
  const { t: tc } = useT('common');
  const has = useAuth((s) => s.has);
  return (
    <CrudModule
      resource="locations"
      title={t('loc.title')}
      subtitle={t('loc.subtitle')}
      scopeSelect
      defaultSort={{ id: 'id', desc: false }}
      schema={locationBaseZ}
      canCreate={has('location', 'create')}
      canUpdate={has('location', 'update')}
      canArchive={has('location', 'archive')}
      createLabel={t('loc.new')}
      cardTitle={(r) => fmtVal(r.name_fr ?? r.name)}
      cardSubtitle={(r) => <BizCode code={r.code as string} />}
      cardBadges={(r) => (
        <>
          <Badge tone="info">{fmtVal(r.kind)}</Badge>
          <Badge>{`${fmtVal(r.capacity)} 🛏`}</Badge>
        </>
      )}
      columns={[
        { key: 'code', label: tc('code'), width: '110px', render: (r) => <BizCode code={r.code as string} copy /> },
        {
          key: 'name',
          label: tc('title'),
          sortable: true,
          render: (r) => {
            const n = r.name_json as Record<string, string> | undefined;
            return <span className="font-semibold">{n?.fr ?? fmtVal(r.name_fr ?? r.name)}</span>;
          },
        },
        { key: 'kind', label: t('loc.kind'), width: '110px', render: (r) => <Badge tone="info">{fmtVal(r.kind)}</Badge> },
        { key: 'capacity', label: t('loc.capacity'), width: '80px', render: (r) => <span className="font-mono">{fmtVal(r.capacity)}</span> },
        { key: 'building', label: t('loc.building'), hideByDefault: true },
        { key: 'wilaya_code', label: t('field.wilaya'), width: '74px', hideByDefault: true },
        { key: 'active', label: tc('active'), width: '84px', render: (r) => (Number(r.active) === 1 ? <Badge tone="ok">{tc('yes')}</Badge> : <Badge>{tc('no')}</Badge>) },
      ]}
      filterFields={[
        { field: 'kind', label: t('loc.kind'), kind: 'select', options: ['cabinet', 'salle', 'bloc', 'labo', 'pharmacie', 'service', 'autre'].map((v) => ({ value: v, label: t(`loc.k.${v}`) })) },
      ]}
      fields={[
        { key: 'kind', label: t('loc.kind'), kind: 'select', options: ['cabinet', 'salle', 'bloc', 'labo', 'pharmacie', 'service', 'autre'].map((v) => ({ value: v, label: t(`loc.k.${v}`) })) },
        { key: 'nameFr', label: `${tc('title')} (FR)`, required: true },
        { key: 'nameAr', label: `${tc('title')} (ع)` },
        { key: 'capacity', label: t('loc.capacity'), kind: 'number', min: 1, max: 500 },
        { key: 'building', label: t('loc.building') },
        { key: 'address', label: t('field.address') },
        { key: 'wilayaCode', label: t('field.wilayaCode'), kind: 'number', min: 1, max: 58 },
        { key: 'openHoursJson', label: t('loc.hours'), kind: 'json', hint: t('loc.hoursHint'), colSpan: 2 },
        { key: 'active', label: tc('active'), kind: 'checkbox' },
      ]}
      transformCreate={(v) => ({ ...v, name: { fr: v.nameFr, ar: v.nameAr }, openHours: safeJson(v.openHoursJson), nameFr: undefined, nameAr: undefined })}
      transformUpdate={(v) => ({ ...v, name: { fr: v.nameFr, ar: v.nameAr }, openHours: safeJson(v.openHoursJson), nameFr: undefined, nameAr: undefined })}
    />
  );
}

function safeJson(v: unknown): unknown {
  if (!v) return undefined;
  try {
    return JSON.parse(String(v));
  } catch {
    return undefined;
  }
}
