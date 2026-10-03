'use client';
/** Praticiens — préfixes configurables (MED/DEN/PHR/INF…), spécialités multilingues, activité. */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck } from 'lucide-react';
import { Badge } from '@/components/ui';
import { BizCode } from '@/components/biz-code';
import { CrudModule, fmtVal } from '@/components/crud';
import { useT } from '@/lib/i18n';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { practitionerBaseZ } from '@sardpi/shared';

export default function PractitionersPage(): React.ReactElement {
  const { t } = useT('patient');
  const { t: tc } = useT('common');
  const has = useAuth((s) => s.has);
  const types = useQuery({ queryKey: ['pract-types'], queryFn: () => api.get<{ rows: { prefix: string; label: string }[] }>('/practitioners/meta/types') });
  const [prefixes, setPrefixes] = useState<{ value: string; label: string }[]>([]);
  void prefixes;
  void setPrefixes;
  const opts = (types.data?.rows ?? []).map((x) => ({ value: x.prefix, label: `${x.prefix} — ${x.label}` }));
  return (
    <CrudModule
      resource="practitioners"
      title={t('pract.title')}
      subtitle={t('pract.subtitle')}
      scopeSelect
      defaultSort={{ id: 'id', desc: true }}
      schema={practitionerBaseZ}
      canCreate={has('practitioners', 'create')}
      canUpdate={has('practitioners', 'update')}
      canArchive={has('practitioners', 'archive')}
      createLabel={t('pract.new')}
      cardTitle={(r) => `${fmtVal(r.last_name)} ${fmtVal(r.first_name)}`}
      cardSubtitle={(r) => <BizCode code={r.code as string} />}
      cardBadges={(r) => (
        <>
          <Badge tone="info">{fmtVal(r.type_prefix)}</Badge>
          {Number(r.active) === 1 ? <Badge tone="ok"><BadgeCheck size={11} /></Badge> : <Badge>{tc('inactive')}</Badge>}
        </>
      )}
      columns={[
        { key: 'code', label: tc('code'), width: '112px', render: (r) => <BizCode code={r.code as string} copy /> },
        {
          key: 'full_name',
          label: t('field.name'),
          sortable: true,
          render: (r) => (
            <span className="font-semibold">
              Dr {fmtVal(r.last_name)} {fmtVal(r.first_name)}
              {r.full_name_ar ? <span className="ms-2 text-[11.5px] text-[rgb(var(--c-muted))]" dir="rtl">{fmtVal(r.full_name_ar)}</span> : null}
            </span>
          ),
        },
        { key: 'type_prefix', label: t('pract.type'), width: '86px', render: (r) => <Badge tone="info">{fmtVal(r.type_prefix)}</Badge> },
        { key: 'speciality_fr', label: t('pract.speciality'), render: (r) => fmtVal((r.speciality_json as Record<string, string>)?.fr ?? r.speciality_fr ?? '—') },
        { key: 'order_number', label: t('pract.orderNumber'), width: '110px', hideByDefault: true, render: (r) => <span dir="ltr" className="font-mono text-[12px]">{fmtVal(r.order_number)}</span> },
        { key: 'email', label: 'e-mail', hideByDefault: true },
        { key: 'phone', label: t('field.phone'), width: '120px', render: (r) => <span dir="ltr" className="font-mono text-[12px]">{fmtVal(r.phone)}</span> },
        { key: 'availability', label: t('pract.availability'), width: '150px', hideByDefault: true },
        {
          key: 'active',
          label: tc('active'),
          width: '84px',
          render: (r) => (Number(r.active) === 1 ? <Badge tone="ok">{tc('active')}</Badge> : <Badge>{tc('inactive')}</Badge>),
        },
      ]}
      filterFields={[
        { field: 'type_prefix', label: t('pract.type'), kind: 'select', options: opts },
        { field: 'active', label: tc('active'), kind: 'select', options: [{ value: '1', label: tc('yes') }, { value: '0', label: tc('no') }] },
      ]}
      fields={[
        { key: 'typePrefix', label: t('pract.type'), kind: 'select', options: opts, required: true },
        { key: 'lastName', label: t('field.lastName'), required: true },
        { key: 'firstName', label: t('field.firstName'), required: true },
        { key: 'lastNameAr', label: t('field.lastNameAr') },
        { key: 'firstNameAr', label: t('field.firstNameAr') },
        { key: 'email', label: 'e-mail', kind: 'email' },
        { key: 'phone', label: t('field.phone'), kind: 'tel' },
        { key: 'orderNumber', label: t('pract.orderNumber') },
        { key: 'specialityFr', label: `${t('pract.speciality')} (FR)` },
        { key: 'specialityAr', label: `${t('pract.speciality')} (ع)` },
        { key: 'availability', label: t('pract.availability'), colSpan: 2 },
        { key: 'active', label: tc('active'), kind: 'checkbox' },
      ]}
      transformCreate={(v) => ({ ...v, speciality: { fr: v.specialityFr, ar: v.specialityAr } })}
      transformUpdate={(v) => ({ ...v, speciality: { fr: v.specialityFr, ar: v.specialityAr } })}
    />
  );
}
