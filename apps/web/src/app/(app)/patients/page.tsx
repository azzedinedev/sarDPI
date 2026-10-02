'use client';
/** Liste des patients — CrudModule configuré (recherche, filtres, colonnes, export, archivage).
 * Groupes sanguins & caisses SS : listes CONFIGURABLES (Réglages › Référentiels médicaux), libellés traduits.
 * Champs riches (allergies, antécédents, notes) : éditeur HTML léger. */
import React from 'react';
import { useSearchParams } from 'next/navigation';
import { Badge } from '@/components/ui';
import { BizCode } from '@/components/biz-code';
import { CrudModule, fmtVal } from '@/components/crud';
import { useT } from '@/lib/i18n';
import { useMedicalRefs, useCountries } from '@/lib/refs';
import { sanitizeRichHtml, htmlToPlain } from '@sardpi/shared';
import { patientCreateZ } from '@sardpi/shared';
import { FileDown } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';

export default function PatientsPage(): React.ReactElement {
  const { t } = useT('patient');
  const { t: tc } = useT('common');
  const sp = useSearchParams();
  const has = useAuth((s) => s.has);
  const refs = useMedicalRefs();
  const { countryOptions, countryLabel } = useCountries();

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
          {r.blood_group ? <Badge tone="warn" title={refs.bloodLabel(r.blood_group)}>{fmtVal(r.blood_group)}</Badge> : null}
          {r.age !== null && r.age !== undefined ? <Badge>{`${fmtVal(r.age)} ${t('unit.years')}`}</Badge> : null}
        </>
      )}
      initialQ={sp.get('q') ?? undefined}
      columns={[
        { key: 'code', label: tc('code'), sortable: true, width: '132px', render: (r) => <BizCode code={r.code as string} copy /> },
        {
          key: 'full_name',
          label: t('field.name'),
          sortable: true,
          render: (r) => (
            <span className="flex items-center gap-2">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[rgb(var(--c-primary)/0.12)] text-[12.5px] font-bold text-[rgb(var(--c-primary))]">{fmtVal(r.last_name).slice(0, 1).toUpperCase()}</span>
              <span className="font-semibold">{fmtVal(r.full_name)}</span>
              {r.full_name_ar ? <span className="text-[12.5px] text-[rgb(var(--c-muted))]" dir="rtl">{fmtVal(r.full_name_ar)}</span> : null}
            </span>
          ),
        },
        {
          key: 'sex',
          label: t('field.sex'),
          width: '96px',
          render: (r) => <Badge tone={r.sex === 'F' ? 'info' : 'neutral'}>{r.sex === 'F' ? t('sex.f') : t('sex.m')}</Badge>,
        },
        { key: 'age', label: t('field.age'), width: '64px', render: (r) => <span className="font-mono">{(r.age as number | null | undefined) ?? '—'}</span> },
        { key: 'birth_date', label: t('field.birthDate'), sortable: true, width: '108px', render: (r) => <span className="font-mono text-[13px]">{fmtVal(r.birth_date).slice(0, 10)}</span> },
        { key: 'phone', label: t('field.phone'), width: '128px', render: (r) => <span dir="ltr" className="font-mono text-[13px]">{fmtVal(r.phone)}</span> },
        { key: 'wilaya_label', label: t('field.wilaya'), width: '140px' },
        { key: 'country', label: t('field.country'), width: '120px', hideByDefault: true, render: (r) => <span className="text-[13px]">{countryLabel(r.country)}</span> },
        { key: 'blood_group', label: t('field.bloodGroup'), width: '92px', render: (r) => (r.blood_group ? <Badge tone="warn" title={refs.bloodLabel(r.blood_group)}>{fmtVal(r.blood_group)}</Badge> : '—') },
        { key: 'attending_name', label: t('field.attending'), width: '160px', hideByDefault: true },
        { key: 'ss_fund', label: t('field.ssFund'), width: '104px', hideByDefault: true, render: (r) => (r.ss_fund ? <Badge tone="info" title={refs.fundLabel(r.ss_fund)}>{fmtVal(r.ss_fund)}</Badge> : '—') },
        { key: 'ss_number', label: t('field.ssNumber'), width: '126px', hideByDefault: true, render: (r) => <span dir="ltr" className="font-mono text-[13px]">{fmtVal(r.ss_number)}</span> },
        { key: 'chifa_number', label: t('field.chifa'), width: '120px', hideByDefault: true, render: (r) => <span dir="ltr" className="font-mono text-[13px]">{fmtVal(r.chifa_number)}</span> },
        { key: 'nin', label: 'NIN', width: '160px', hideByDefault: true, render: (r) => <span dir="ltr" className="font-mono text-[13px]">{fmtVal(r.nin)}</span> },
        {
          key: 'allergies_json',
          label: t('field.allergies'),
          width: '180px',
          hideByDefault: true,
          render: (r) => <AllergyChips value={r.allergies_json} />,
        },
        { key: 'updated_at', label: tc('updatedAt'), sortable: true, width: '140px', hideByDefault: true, render: (r) => <span className="font-mono text-[12.5px] text-[rgb(var(--c-muted))]">{fmtVal(r.updated_at)}</span> },
      ]}
      filterFields={[
        { field: 'sex', label: t('field.sex'), kind: 'select', options: [{ value: 'M', label: t('sex.m') }, { value: 'F', label: t('sex.f') }] },
        { field: 'blood_group', label: t('field.bloodGroup'), kind: 'select', options: refs.bloodGroups.map((g) => ({ value: g.code, label: `${g.code} — ${refs.bloodLabel(g.code)}` })) },
        { field: 'birth_date', label: t('field.birthDate'), kind: 'date' },
        { field: 'wilaya_code', label: t('field.wilaya'), kind: 'number' },
        { field: 'ss_fund', label: t('field.ssFund'), kind: 'select', options: refs.ssFunds.map((f) => ({ value: f.code, label: f.code })) },
      ]}
      fields={[
        // ————— identité
        { key: 'lastName', label: t('field.lastName'), required: true, group: t('group.identity') },
        { key: 'firstName', label: t('field.firstName'), required: true, group: t('group.identity') },
        { key: 'lastNameAr', label: t('field.lastNameAr'), group: t('group.identity') },
        { key: 'firstNameAr', label: t('field.firstNameAr'), group: t('group.identity') },
        { key: 'birthDate', label: t('field.birthDate'), kind: 'date', group: t('group.identity') },
        { key: 'sex', label: t('field.sex'), kind: 'select', options: [{ value: 'M', label: t('sex.m') }, { value: 'F', label: t('sex.f') }], group: t('group.identity') },
        { key: 'preferredLocale', label: t('field.lang'), kind: 'select', options: [
          { value: 'fr', label: 'Français' },
          { value: 'ar', label: 'العربية' },
          { value: 'es', label: 'Español' },
          { value: 'en', label: 'English' },
        ], group: t('group.identity') },
        // ————— localisation
        { key: 'country', label: t('field.country'), kind: 'select', options: countryOptions, group: t('group.location') },
        { key: 'wilayaCode', label: t('field.wilayaCode'), kind: 'number', min: 1, max: 58, hint: t('field.wilayaHint'), group: t('group.location') },
        { key: 'daira', label: t('field.daira'), group: t('group.location') },
        { key: 'commune', label: t('field.commune'), group: t('group.location') },
        { key: 'address', label: t('field.address'), kind: 'textarea', group: t('group.location') },
        // ————— contact
        { key: 'phone', label: t('field.phone'), kind: 'tel', group: t('group.contact') },
        { key: 'email', label: t('field.email'), kind: 'email', group: t('group.contact') },
        { key: 'emergencyName', label: t('field.emergencyName'), group: t('group.contact') },
        { key: 'emergencyPhone', label: t('field.emergencyPhone'), kind: 'tel', group: t('group.contact') },
        { key: 'emergencyRelation', label: t('field.emergencyRelation'), group: t('group.contact') },
        // ————— identifiants
        { key: 'nin', label: t('field.nin'), hint: t('field.ninHint'), group: t('group.ids') },
        { key: 'chifaNumber', label: t('field.chifa'), group: t('group.ids') },
        // ————— couverture sociale
        { key: 'ssFund', label: t('field.ssFund'), kind: 'select', options: refs.fundOptions, group: t('group.insurance') },
        { key: 'ssNumber', label: t('field.ssNumber'), group: t('group.insurance') },
        { key: 'havingRight', label: t('field.havingRight'), kind: 'checkbox', group: t('group.insurance') },
        { key: 'thirdPartyPayer', label: t('field.thirdPartyPayer'), kind: 'checkbox', group: t('group.insurance') },
        // ————— médical (éditeur HTML)
        { key: 'bloodGroup', label: t('field.bloodGroup'), kind: 'select', options: refs.bloodOptions, group: t('group.medical') },
        { key: 'allergies', label: t('field.allergies'), kind: 'richtext', hint: t('field.htmlHint'), group: t('group.medical') },
        { key: 'antecedents', label: t('field.antecedents'), kind: 'richtext', hint: t('field.htmlHint'), group: t('group.medical') },
        { key: 'notes', label: t('field.notes'), kind: 'richtext', hint: t('field.htmlHint'), colSpan: 2, group: t('group.notes') },
      ]}
      rowMenu={(r) => (
        <div className="border-t border-[rgb(var(--c-line)/0.6)] pt-1">
          <button
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-[14px] font-medium hover:bg-[rgb(var(--c-surface-2))]"
            onClick={() => void api.download(`/patients/${r.id}/export`, `dossier-${(r.code as string) ?? r.id}.json`).catch(() => undefined)}
          >
            <FileDown size={15} /> {t('actions.export')}
          </button>
        </div>
      )}
    />
  );
}

/** Allergies : liste legacy (array) ou HTML riche → pastilles lisibles en colonne. */
function AllergyChips({ value }: { value: unknown }): React.ReactElement | null {
  const items: string[] = Array.isArray(value)
    ? (value as unknown[]).map((v) => String(v))
    : typeof value === 'string' && value.trim()
      ? htmlToPlain(sanitizeRichHtml(value)).split(/[\n;]+/).map((x) => x.trim()).filter(Boolean)
      : [];
  if (!items.length) return <span className="text-[rgb(var(--c-muted)/0.5)]">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {items.slice(0, 3).map((a) => (
        <Badge key={a} tone="danger">{a}</Badge>
      ))}
      {items.length > 3 ? <Badge>+{items.length - 3}</Badge> : null}
    </span>
  );
}
