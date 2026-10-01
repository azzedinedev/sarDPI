'use client';
/** Liste des patients — CrudModule configuré (recherche, filtres, colonnes, export, archivage). */
import React from 'react';
import { useSearchParams } from 'next/navigation';
import { Badge } from '@/components/ui';
import { BizCode } from '@/components/biz-code';
import { CrudModule, fmtVal } from '@/components/crud';
import { useT } from '@/lib/i18n';
import { patientCreateZ } from '@sardpi/shared';
import { FileDown } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';

export default function PatientsPage(): React.ReactElement {
  const { t } = useT('patient');
  const { t: tc } = useT('common');
  const sp = useSearchParams();
  const has = useAuth((s) => s.has);

  return (
    <CrudModule
      resource="patients"
      title={t('list.title')}
      subtitle={t('list.subtitle')}
      searchPlaceholder={t('list.searchPlaceholder')}
      defaultSort={{ id: 'updated_at', desc: true }}
      scopeSelect
      softDelete
      canCreate={has('patients', 'create')}
      canUpdate={has('patients', 'update')}
      canDelete={has('patients', 'delete')}
      canArchive={has('patients', 'archive')}
      schema={patientCreateZ}
      createLabel={t('list.new')}
      rowHref={(r) => `/patients/${r.id}`}
      cardTitle={(r) => (r.full_name as string) ?? `${fmtVal(r.last_name)} ${fmtVal(r.first_name)}`}
      cardSubtitle={(r) => (
        <span className="flex items-center gap-2">
          <BizCode code={r.code as string} />
          <span>{fmtVal(r.wilaya_label)}</span>
        </span>
      )}
      cardBadges={(r) => (
        <>
          <Badge tone={r.sex === 'F' ? 'info' : 'neutral'}>{r.sex === 'F' ? t('sex.f') : t('sex.m')}</Badge>
          {r.blood_group ? <Badge tone="warn">{fmtVal(r.blood_group)}</Badge> : null}
          {r.age !== null && r.age !== undefined ? <Badge>{`${fmtVal(r.age)} ${t('unit.years')}`}</Badge> : null}
        </>
      )}
      initialQ={sp.get('q') ?? undefined}
      columns={[
        { key: 'code', label: tc('code'), sortable: true, width: '126px', render: (r) => <BizCode code={r.code as string} copy /> },
        {
          key: 'full_name',
          label: t('field.name'),
          sortable: true,
          render: (r) => (
            <span className="flex items-center gap-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[rgb(var(--c-primary)/0.12)] text-[11px] font-bold text-[rgb(var(--c-primary))]">{fmtVal(r.last_name).slice(0, 1).toUpperCase()}</span>
              <span className="font-semibold">{fmtVal(r.full_name)}</span>
              {r.full_name_ar ? <span className="text-[11.5px] text-[rgb(var(--c-muted))]" dir="rtl">{fmtVal(r.full_name_ar)}</span> : null}
            </span>
          ),
        },
        {
          key: 'sex',
          label: t('field.sex'),
          width: '64px',
          render: (r) => <Badge tone={r.sex === 'F' ? 'info' : 'neutral'}>{r.sex === 'F' ? t('sex.f') : t('sex.m')}</Badge>,
        },
        { key: 'age', label: t('field.age'), width: '60px', render: (r) => <span className="font-mono">{(r.age as number | null | undefined) ?? '—'}</span> },
        { key: 'birth_date', label: t('field.birthDate'), sortable: true, width: '100px', render: (r) => <span className="font-mono text-[12px]">{fmtVal(r.birth_date).slice(0, 10)}</span> },
        { key: 'phone', label: t('field.phone'), width: '118px', render: (r) => <span dir="ltr" className="font-mono text-[12px]">{fmtVal(r.phone)}</span> },
        { key: 'wilaya_label', label: t('field.wilaya'), width: '130px', render: (r) => <span className="text-[12.5px]">{fmtVal(r.wilaya_label)}</span> },
        { key: 'blood_group', label: t('field.bloodGroup'), width: '80px', render: (r) => (r.blood_group ? <Badge tone="warn">{fmtVal(r.blood_group)}</Badge> : '—') },
        { key: 'attending_name', label: t('field.attending'), width: '150px', hideByDefault: true },
        { key: 'ss_fund', label: t('field.ssFund'), width: '86px', hideByDefault: true, render: (r) => (r.ss_fund ? <Badge tone="info">{fmtVal(r.ss_fund)}</Badge> : '—') },
        { key: 'ss_number', label: t('field.ssNumber'), width: '120px', hideByDefault: true, render: (r) => <span dir="ltr" className="font-mono text-[12px]">{fmtVal(r.ss_number)}</span> },
        { key: 'chifa_number', label: t('field.chifa'), width: '110px', hideByDefault: true, render: (r) => <span dir="ltr" className="font-mono text-[12px]">{fmtVal(r.chifa_number)}</span> },
        { key: 'nin', label: 'NIN', width: '150px', hideByDefault: true, render: (r) => <span dir="ltr" className="font-mono text-[12px]">{fmtVal(r.nin)}</span> },
        { key: 'updated_at', label: tc('updatedAt'), sortable: true, width: '130px', hideByDefault: true, render: (r) => <span className="font-mono text-[11.5px] text-[rgb(var(--c-muted))]">{fmtVal(r.updated_at)}</span> },
      ]}
      filterFields={[
        { field: 'sex', label: t('field.sex'), kind: 'select', options: [{ value: 'M', label: 'M' }, { value: 'F', label: 'F' }] },
        { field: 'blood_group', label: t('field.bloodGroup'), kind: 'select', options: ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'].map((v) => ({ value: v, label: v })) },
        { field: 'birth_date', label: t('field.birthDate'), kind: 'date' },
        { field: 'wilaya_code', label: t('field.wilaya'), kind: 'number' },
        { field: 'ss_fund', label: t('field.ssFund'), kind: 'select', options: [{ value: 'CNAS', label: 'CNAS' }, { value: 'CASNOS', label: 'CASNOS' }, { value: 'CNMA', label: 'CNMA' }] },
      ]}
      fields={[
        { key: 'lastName', label: t('field.lastName'), required: true },
        { key: 'firstName', label: t('field.firstName'), required: true },
        { key: 'lastNameAr', label: t('field.lastNameAr') },
        { key: 'firstNameAr', label: t('field.firstNameAr') },
        { key: 'birthDate', label: t('field.birthDate'), kind: 'date' },
        { key: 'sex', label: t('field.sex'), kind: 'select', options: [{ value: 'M', label: t('sex.m') }, { value: 'F', label: t('sex.f') }] },
        { key: 'bloodGroup', label: t('field.bloodGroup'), kind: 'select', options: ['', 'O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'].map((v) => ({ value: v, label: v || '—' })) },
        { key: 'phone', label: t('field.phone'), kind: 'tel' },
        { key: 'email', label: t('field.email'), kind: 'email' },
        { key: 'nin', label: t('field.nin'), hint: t('field.ninHint') },
        { key: 'ssFund', label: t('field.ssFund'), kind: 'select', options: [{ value: '', label: '—' }, { value: 'CNAS', label: 'CNAS' }, { value: 'CASNOS', label: 'CASNOS' }, { value: 'CNMA', label: 'CNMA' }] },
        { key: 'ssNumber', label: t('field.ssNumber') },
        { key: 'chifaNumber', label: t('field.chifa') },
        { key: 'havingRight', label: t('field.havingRight'), kind: 'checkbox' },
        { key: 'thirdPartyPayer', label: t('field.thirdPartyPayer'), kind: 'checkbox' },
        { key: 'wilayaCode', label: t('field.wilayaCode'), kind: 'number', min: 1, max: 58, hint: t('field.wilayaHint') },
        { key: 'daira', label: t('field.daira') },
        { key: 'commune', label: t('field.commune') },
        { key: 'address', label: t('field.address'), kind: 'textarea' },
        { key: 'emergencyName', label: t('field.emergencyName') },
        { key: 'emergencyPhone', label: t('field.emergencyPhone'), kind: 'tel' },
        { key: 'emergencyRelation', label: t('field.emergencyRelation') },
        { key: 'allergies', label: t('field.allergies'), hint: t('field.csvHint'), render: (v) => (Array.isArray(v) ? (v as string[]).join(', ') : fmtVal(v)) },
        { key: 'antecedents', label: t('field.antecedents'), hint: t('field.csvHint') },
        { key: 'preferredLocale', label: t('field.lang'), kind: 'select', options: [
          { value: 'fr', label: 'Français' },
          { value: 'ar', label: 'العربية' },
          { value: 'es', label: 'Español' },
          { value: 'en', label: 'English' },
        ] },
        { key: 'notes', label: t('field.notes'), kind: 'textarea', colSpan: 2 },
      ]}
      transformCreate={(v) => ({ ...v, allergies: toList(v.allergies), antecedents: toList(v.antecedents) })}
      transformUpdate={(v) => ({ ...v, allergies: toList(v.allergies), antecedents: toList(v.antecedents) })}
      rowMenu={(r) => (
        <div className="border-t border-[rgb(var(--c-line)/0.6)] pt-1">
          <button
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-[13px] font-medium hover:bg-[rgb(var(--c-surface-2))]"
            onClick={() => void api.download(`/patients/${r.id}/export`, `dossier-${(r.code as string) ?? r.id}.json`).catch(() => undefined)}
          >
            <FileDown size={14} /> {t('actions.export')}
          </button>
        </div>
      )}
    />
  );
}

function toList(v: unknown): string[] | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  if (Array.isArray(v)) return v as string[];
  return String(v)
    .split(/[,;、\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 30);
}
