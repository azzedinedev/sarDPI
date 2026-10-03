'use client';
/** Ordonnances — liste toutes catégories, statut, imprimable ; création via l’éditeur. */
import React from 'react';
import { useRouter } from 'next/navigation';
import { NotebookText, Plus } from 'lucide-react';
import { Badge } from '@/components/ui';
import { BizCode } from '@/components/biz-code';
import { CrudModule, fmtVal } from '@/components/crud';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/stores/auth';
import { Button } from '@/components/ui';

export default function PrescriptionsListPage(): React.ReactElement {
  const { t } = useT('patient');
  const { t: tc } = useT('common');
  const has = useAuth((s) => s.has);
  const router = useRouter();
  return (
    <CrudModule
      resource="prescriptions"
      title={t('rx.title')}
      subtitle={t('rx.subtitle')}
      defaultSort={{ id: 'id', desc: true }}
      canCreate={false}
      canUpdate={false}
      canDelete={has('prescriptions', 'delete')}
      canArchive={false}
      scopeSelect
      rowHref={(r) => `/prescriptions/${r.id}`}
      cardTitle={(r) => `${t('rx.rx')} ${fmtVal(r.code)}`}
      cardSubtitle={(r) => <span>{fmtVal(r.patient_name)}</span>}
      cardBadges={(r) => (
        <Badge tone={r.status === 'validated' ? 'ok' : r.status === 'cancelled' ? 'danger' : 'warn'}>{fmtVal(r.status)}</Badge>
      )}
      columns={[
        { key: 'code', label: tc('code'), width: '210px', render: (r) => <BizCode code={r.code as string} copy /> },
        { key: 'patient_name', label: t('field.patient'), render: (r) => <span className="font-semibold">{fmtVal(r.patient_name)}</span> },
        { key: 'patient_code', label: tc('code'), width: '110px', hideByDefault: true, render: (r) => <BizCode code={r.patient_code as string} /> },
        { key: 'act_date', label: tc('date'), sortable: true, width: '100px', render: (r) => <span className="font-mono text-[12px]">{fmtVal(r.act_date ?? r.created_at).slice(0, 10)}</span> },
        { key: 'practitioner_name', label: t('rx.prescriber'), width: '160px' },
        { key: 'status', label: t('rx.status'), width: '105px', render: (r) => <Badge tone={r.status === 'validated' ? 'ok' : r.status === 'cancelled' ? 'danger' : 'warn'}>{fmtVal(r.status)}</Badge> },
        { key: 'refills', label: t('rx.refills'), width: '70px', hideByDefault: true },
      ]}
      filterFields={[
        { field: 'status', label: t('rx.status'), kind: 'select', options: [{ value: 'draft', label: t('rx.st.draft') }, { value: 'validated', label: t('rx.st.validated') }, { value: 'cancelled', label: t('rx.st.cancelled') }] },
        { field: 'act_date', label: tc('date'), kind: 'date' },
      ]}
      toolbarExtra={
        has('prescriptions', 'create') ? (
          <Button size="sm" variant="primary" onClick={() => router.push('/prescriptions/new')}>
            <Plus size={14} /> <NotebookText size={14} /> {t('rx.new')}
          </Button>
        ) : null
      }
    />
  );
}
