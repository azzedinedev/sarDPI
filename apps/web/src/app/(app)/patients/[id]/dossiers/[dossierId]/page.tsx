'use client';

/**
 * Détail d'un DOSSIER patient (patient_cases) lié à une catégorie.
 * Sous-onglets : Suivi & workflow · Fiches · Documents · RDV · Ordonnances · Historique.
 * Les données viennent de GET /dossiers/:id (liaison hybride : case_id explicite sinon repli catégorie).
 */
import React, { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Activity, AlertCircle, AlertTriangle, ArrowLeft, BadgeCheck, CalendarRange, CheckCircle2, FileText, FolderOpen, HeartPulse, Pill, Plus, Undo2, Workflow as WorkflowIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Badge, Button, EmptyState, Tabs } from '@/components/ui';
import { BizCode } from '@/components/biz-code';
import { Card, fmtVal } from '@/components/crud';
import { CaseStepper, type Step } from '@/components/case-stepper';
import { RecordDialog } from '@/components/record-dialog';
import { GedUploadButton } from '@/components/ged-upload';
import { ApptQuickButton } from '@/components/appt-quick-dialog';
import { useAuth } from '@/stores/auth';
import { useToast } from '@/components/toast';
import { useFmtDate } from '@/lib/display';

interface DossierDetail {
  case: { id: number; code: string; title: string | null; category_prefix: string | null; category_label: string; category_color: string | null; status: string; current_step: string | null; opened_at: string | null; closed_at: string | null };
  steps: Step[];
  records: { id: number; code: string; category_prefix: string | null; type_label: string; summary: Record<string, string> | null; act_date: string | null; status: string; appointment_id: number | null }[];
  appointments: { id: number; code: string; start_at: string; end_at: string; status: string; reason: string | null; practitioner_name: string | null; location_name: string | null }[];
  prescriptions: { id: number; code: string; act_date: string | null; status: string; practitioner_name: string | null }[];
  documents: { id: number; code: string; title: string | null; type_prefix: string; current_version: number; record_id: number | null; created_at: string | null }[];
  history: { id: number; kind: string; at: string; ref_code: string | null; tone: string | null; summary: Record<string, string> | null }[];
}

function pickAny(s: Record<string, string> | string | null | undefined, lang: string): string {
  if (!s) return '';
  if (typeof s === 'string') return s;
  return s[lang] ?? s.fr ?? s.en ?? s.ar ?? s.es ?? Object.values(s)[0] ?? '';
}

export default function DossierPage(): React.ReactElement {
  const { id, dossierId } = useParams<{ id: string; dossierId: string }>();
  const pid = Number(id);
  const did = Number(dossierId);
  const router = useRouter();
  const { t } = useT('patient');
  const { t: tc, lang } = useT('common');
  const fmt = useFmtDate();
  const has = useAuth((s) => s.has);
  const [tab, setTab] = useState('suivi');
  const qc = useQueryClient();
  const toast = useToast();
  // fiche ouverte dans la modale de détail/édition (edit=true → directement en édition)
  const [recordDlg, setRecordDlg] = useState<{ id: number; edit: boolean } | null>(null);

  const dq = useQuery({ queryKey: ['dossier', did], queryFn: () => api.get<DossierDetail>(`/dossiers/${did}`), enabled: Number.isFinite(did) });
  const patient = useQuery({ queryKey: ['patient', pid], queryFn: () => api.get<Record<string, unknown>>(`/patients/${pid}`) });
  // catalogue : module de la catégorie (permissions) + premier type actif (fiche par défaut)
  const catalog = useQuery({ queryKey: ['catalog'], queryFn: () => api.get<{ categories: { prefix: string; module: string }[]; types: { id: number; category_prefix: string; active: number }[] }>('/refs/catalog') });

  // Création d'une fiche par défaut : 1er type de la catégorie, aujourd'hui, brouillon, liée au dossier,
  // puis ouverture immédiate en édition pour la compléter (champs clé→valeur).
  const createDefaultRecord = useMutation({
    mutationFn: (typeId: number) =>
      api.post<{ id: number }>('/records', { patientId: pid, typeId, actDate: new Date().toISOString().slice(0, 10), caseId: did, status: 'draft', fields: {} }),
    onSuccess: (r) => {
      toast.success(t('dossier.recordCreated'));
      void qc.invalidateQueries({ queryKey: ['dossier', did] });
      void qc.invalidateQueries({ queryKey: ['dossiers', pid] });
      setRecordDlg({ id: Number(r.id), edit: true });
    },
    onError: (e: unknown) => toast.error(t(`errors.${(e as { code?: string }).code ?? 'network'}`)),
  });

  if (dq.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <div className="skeleton h-24 w-full" />
        <div className="skeleton h-64 w-full" />
      </div>
    );
  }
  if (dq.isError || !dq.data) {
    return <EmptyState icon={AlertTriangle} title={tc('notFound')} action={<Button onClick={() => router.push(`/patients/${pid}`)}>{t('dossier.backToPatient')}</Button>} />;
  }

  const d = dq.data;
  const kase = d.case;
  const patientName = patient.data ? ((patient.data.full_name as string) ?? `${fmtVal(patient.data.last_name)} ${fmtVal(patient.data.first_name)}`) : '';
  const editable = has('patient_case', 'update');

  // permissions d'ajout par sous-onglet (le module de fiches dépend de la catégorie du dossier)
  const catModule = catalog.data?.categories.find((c) => c.prefix === kase.category_prefix)?.module ?? 'records';
  const canAddRecord = has(catModule, 'create');
  const canEditRecord = has(catModule, 'update');
  const canAddDoc = has('ged', 'create');
  const canAddAppt = has('appointment', 'create');
  const canAddRx = has('prescription', 'create');
  const defaultTypeId = catalog.data?.types.find((x) => x.category_prefix === kase.category_prefix && Number(x.active))?.id ?? null;
  const refreshDossier = (): void => {
    void qc.invalidateQueries({ queryKey: ['dossier', did] });
  };
  const onAddRecord = (): void => {
    if (defaultTypeId == null) {
      toast.error(t('dossier.noType'));
      return;
    }
    createDefaultRecord.mutate(defaultTypeId);
  };

  const KIND_ICON: Record<string, React.ReactNode> = {
    record: <Activity size={13} />, rx: <HeartPulse size={13} />, ged: <FileText size={13} />, consent: <BadgeCheck size={13} />,
    note: <BadgeCheck size={13} />, movement: <WorkflowIcon size={13} />, case: <WorkflowIcon size={13} />, lab: <Activity size={13} />,
  };
  const toneIcon = (tone: string | null): React.ReactNode | null =>
    tone === 'cancel' ? <Undo2 size={13} /> : tone === 'ok' ? <CheckCircle2 size={13} /> : tone === 'warn' ? <AlertCircle size={13} /> : null;
  const toneClass = (tone: string | null): string =>
    tone === 'cancel' ? 'border-[rgb(var(--c-coral)/0.5)] text-[rgb(var(--c-coral))]' : tone === 'ok' ? 'border-[rgb(var(--c-line))] text-[rgb(var(--c-ok))]' : tone === 'warn' ? 'border-[rgb(var(--c-line))] text-[rgb(var(--c-amber))]' : 'border-[rgb(var(--c-line))] text-[rgb(var(--c-primary))]';

  const rowCls = 'flex items-center gap-3 rounded-xl border border-[rgb(var(--c-line)/0.6)] p-2.5 text-start transition-colors hover:bg-[rgb(var(--c-primary-soft)/0.4)]';

  return (
    <div className="flex flex-col gap-3">
      {/* ------- en-tête dossier ------- */}
      <Card className="flex flex-col gap-3">
        <Link href={`/patients/${pid}`} className="btn btn-ghost btn-sm w-fit gap-1.5 text-[12.5px]">
          <ArrowLeft size={15} className="rtl:rotate-180" /> {t('dossier.backToPatient')}
          {patientName ? <span className="text-[rgb(var(--c-muted))]">· {patientName}</span> : null}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white" style={{ background: kase.category_color ?? 'rgb(var(--c-primary))' }}>
            <FolderOpen size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[18px] font-extrabold leading-tight">{kase.category_label}</h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-[rgb(var(--c-muted))]">
              <BizCode code={kase.code} copy />
              <Badge tone={kase.status === 'closed' ? 'neutral' : 'info'}>{kase.status === 'closed' ? t('workflow.closed') : t('workflow.open')}</Badge>
              {kase.opened_at ? <span dir="ltr" className="tabular-nums">{t('dossier.opened')} {fmt(kase.opened_at)}</span> : null}
            </div>
          </div>
        </div>
      </Card>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'suivi', label: t('dossier.suivi') },
          { key: 'records', label: `${t('dossier.records')} (${d.records.length})` },
          { key: 'documents', label: `${t('dossier.documents')} (${d.documents.length})` },
          { key: 'appts', label: `${t('dossier.appointments')} (${d.appointments.length})` },
          { key: 'rx', label: `${t('dossier.prescriptions')} (${d.prescriptions.length})` },
          { key: 'history', label: t('dossier.history') },
        ]}
      />

      {tab === 'suivi' ? <CaseStepper pid={pid} caseId={did} editable={editable} /> : null}

      {tab === 'records' ? (
        <Card className="flex flex-col gap-2">
          {canAddRecord ? (
            <div className="flex justify-end">
              <Button size="sm" variant="primary" loading={createDefaultRecord.isPending} onClick={onAddRecord}>
                <Plus size={14} /> {t('dossier.addRecord')}
              </Button>
            </div>
          ) : null}
          {!d.records.length ? <EmptyState icon={Activity} title={t('dossier.noItems')} /> : null}
          {d.records.map((r, i) => (
            <motion.button key={r.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.02 }}
              onClick={() => setRecordDlg({ id: r.id, edit: false })} className={rowCls}>
              <Badge tone="info">{r.category_prefix}</Badge>
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{r.type_label || pickAny(r.summary, lang) || tc('untitled')}</span>
              <span dir="ltr" className="tabular-nums text-[11.5px] text-[rgb(var(--c-muted))]">{r.act_date ? fmt(r.act_date, true) : ''}</span>
              <BizCode code={r.code} />
              <span className={`badge ${r.status === 'validated' ? 'text-[rgb(var(--c-ok))]' : 'text-[rgb(var(--c-muted))]'}`}>{fmtVal(r.status)}</span>
            </motion.button>
          ))}
        </Card>
      ) : null}

      {tab === 'documents' ? (
        <Card className="flex flex-col gap-2">
          {canAddDoc ? (
            <div className="flex justify-end">
              <GedUploadButton pid={pid} caseId={did} label={t('dossier.addDocument')} onDone={refreshDossier} />
            </div>
          ) : null}
          {!d.documents.length ? <EmptyState icon={FileText} title={t('dossier.noItems')} /> : null}
          {d.documents.map((doc, i) => (
            <motion.div key={doc.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.02 }} className={rowCls}>
              <Badge>{doc.type_prefix}</Badge>
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{doc.title || tc('untitled')}</span>
              <span className="badge">v{doc.current_version}</span>
              <span dir="ltr" className="tabular-nums text-[11.5px] text-[rgb(var(--c-muted))]">{doc.created_at ? fmt(doc.created_at) : ''}</span>
              <BizCode code={doc.code} />
            </motion.div>
          ))}
        </Card>
      ) : null}

      {tab === 'appts' ? (
        <Card className="flex flex-col gap-2">
          {canAddAppt ? (
            <div className="flex justify-end">
              <ApptQuickButton pid={pid} caseId={did} label={t('dossier.addAppt')} onSaved={refreshDossier} />
            </div>
          ) : null}
          {!d.appointments.length ? <EmptyState icon={CalendarRange} title={t('dossier.noItems')} /> : null}
          {d.appointments.map((a, i) => (
            <motion.div key={a.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.02 }} className={rowCls}>
              <span dir="ltr" className="tabular-nums text-[12px] text-[rgb(var(--c-muted))]">{fmt(a.start_at, true)}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{a.reason || a.practitioner_name || a.code}</span>
              {a.location_name ? <span className="badge hidden sm:inline">{a.location_name}</span> : null}
              <Badge tone={a.status === 'done' ? 'ok' : a.status === 'cancelled' ? 'danger' : 'warn'}>{fmtVal(a.status)}</Badge>
              <BizCode code={a.code} />
            </motion.div>
          ))}
        </Card>
      ) : null}

      {tab === 'rx' ? (
        <Card className="flex flex-col gap-2">
          {canAddRx ? (
            <div className="flex justify-end">
              <Button size="sm" variant="primary" onClick={() => router.push(`/prescriptions/new?patient=${pid}&case=${did}`)}>
                <Pill size={14} /> {t('dossier.addRx')}
              </Button>
            </div>
          ) : null}
          {!d.prescriptions.length ? <EmptyState icon={HeartPulse} title={t('dossier.noItems')} /> : null}
          {d.prescriptions.map((p, i) => (
            <motion.button key={p.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.02 }}
              onClick={() => router.push(`/prescriptions/${p.id}`)} className={rowCls}>
              <span dir="ltr" className="tabular-nums text-[12px] text-[rgb(var(--c-muted))]">{p.act_date ? fmt(p.act_date, true) : ''}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{p.practitioner_name || p.code}</span>
              <Badge tone={p.status === 'signed' ? 'ok' : p.status === 'cancelled' ? 'danger' : 'warn'}>{fmtVal(p.status)}</Badge>
              <BizCode code={p.code} />
            </motion.button>
          ))}
        </Card>
      ) : null}

      {tab === 'history' ? (
        <Card className="flex flex-col gap-3">
          {!d.history.length ? <EmptyState icon={Activity} title={t('dossier.noItems')} /> : null}
          <ul className="relative flex flex-col gap-0">
            {d.history.map((ev, i) => (
              <motion.li key={ev.id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 15) * 0.02 }}
                className="relative flex items-start gap-3 border-s-2 border-[rgb(var(--c-line))] py-2 ltr:ps-4 rtl:pe-4 rtl:border-s-0 rtl:border-e-2">
                <span className={`absolute top-3 grid h-6 w-6 -translate-x-1/2 place-items-center rounded-full border bg-[rgb(var(--c-surface))] ltr:left-0 rtl:left-auto rtl:-translate-x-[-50%] rtl:translate-x-1/2 rtl:right-0 rtl:border-e-0 ${toneClass(ev.tone)}`}>
                  {toneIcon(ev.tone) ?? KIND_ICON[ev.kind] ?? <BadgeCheck size={12} />}
                </span>
                <span dir="ltr" className="mt-0.5 shrink-0 tabular-nums text-[11.5px] text-[rgb(var(--c-muted))]">{fmt(ev.at, true)}</span>
                <span className="min-w-0 flex-1 text-[13px]">{pickAny(ev.summary, lang)}</span>
                {ev.ref_code ? <BizCode code={ev.ref_code} /> : null}
              </motion.li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* détail / édition d'une fiche : clic sur une fiche (lecture) ou fiche par défaut venant d'être créée (édition) */}
      <RecordDialog
        recordId={recordDlg?.id ?? null}
        open={recordDlg != null}
        startInEdit={recordDlg?.edit ?? false}
        editable={canEditRecord}
        onClose={() => setRecordDlg(null)}
        onSaved={refreshDossier}
      />
    </div>
  );
}
