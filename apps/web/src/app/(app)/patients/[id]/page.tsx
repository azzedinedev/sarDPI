'use client';
/**
 * Fiche patient — en-tête (identité, badges, QR/vérification, impression, consentement)
 * puis onglets : Antécédents, Documents médicaux (toutes catégories), GED, Circuit de soins
 * (workflow §8.3), Mouvements, Rendez-vous, Ordonnances, Notes.
 */
import React, { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Activity, AlertTriangle, BadgeCheck, CalendarPlus, Download, HeartPulse, Printer, QrCode, Shield, ShieldCheck, ShieldX, Syringe, Upload, Workflow as WorkflowIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Badge, Button, EmptyState, Field, Input, Select, Tabs, Textarea } from '@/components/ui';
import { Dialog } from '@/components/dialogs';
import { BizCode } from '@/components/biz-code';
import { CrudModule, Card, fmtVal } from '@/components/crud';
import { useToast } from '@/components/toast';
import { useAuth } from '@/stores/auth';
import { age } from '@/lib/format';

export default function PatientPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const pid = Number(id);
  const router = useRouter();
  const { t } = useT('patient');
  const { t: tc } = useT('common');
  const [tab, setTab] = useState('history');
  const [qrOpen, setQrOpen] = useState(false);
  const has = useAuth((s) => s.has);
  const qc = useQueryClient();

  const patient = useQuery({ queryKey: ['patient', pid], queryFn: () => api.get<Record<string, unknown>>(`/patients/${pid}`) });
  const consent = (patient.data?.consent_json as { granted?: boolean; scopes?: string[] } | undefined) ?? undefined;

  const history = useQuery({ queryKey: ['history', pid], queryFn: () => api.get<{ rows: { id: number; kind: string; at: string; ref_code: string | null; summary: Record<string, string> | null }[] }>(`/patients/${pid}/history?mode=${tab === 'history' ? 'reduced' : 'reduced'}`), enabled: tab === 'history' });

  const badge = useQuery({ queryKey: ['badge', pid], queryFn: () => api.get<{ qr: string; barcode: string; url: string; code: string; name: string }>(`/patients/${pid}/badge-assets`), enabled: qrOpen, staleTime: 300_000 });

  const consentMut = useMutation({
    mutationFn: (granted: boolean) => api.post(`/patients/${pid}/consent`, { granted, scopes: consent?.scopes ?? ['care', 'documents'] }),
    onSuccess: () => {
      toast.success(tc('saved'));
      void qc.invalidateQueries({ queryKey: ['patient', pid] });
      void qc.invalidateQueries({ queryKey: ['history', pid] });
    },
  });
  const toast = useToast();

  if (patient.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <div className="skeleton h-36 w-full" />
        <div className="skeleton h-64 w-full" />
      </div>
    );
  }
  if (patient.isError) {
    return <EmptyState icon={AlertTriangle} title={tc('notFound')} action={<Button onClick={() => router.push('/patients')}>{tc('back')}</Button>} />;
  }

  const p = patient.data!;
  const fullName = (p.full_name as string) ?? `${fmtVal(p.last_name)} ${fmtVal(p.first_name)}`;

  return (
    <div className="flex flex-col gap-3">
      {/* ------- en-tête identité ------- */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
        <Card className="flex flex-wrap items-center gap-4 p-5">
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-3xl bg-gradient-to-br from-[rgb(var(--c-primary))] to-[rgb(var(--c-mint))] text-2xl font-bold text-white shadow-[var(--shadow-glow)]">
            {fmtVal(p.last_name).slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-[220px] flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[21px] font-bold leading-tight">{fullName}</h1>
              <BizCode code={p.code as string} copy />
              {Number(p.gender ?? p.sex) === 2 || p.sex === 'F' ? <Badge tone="info">{t('sex.f')}</Badge> : <Badge>{t('sex.m')}</Badge>}
            </div>
            {p.full_name_ar ? <div dir="rtl" className="mt-0.5 text-[13px] font-semibold text-[rgb(var(--c-muted))]">{fmtVal(p.full_name_ar)}</div> : null}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-[rgb(var(--c-muted))]">
              <span>🎂 {fmtVal(p.birth_date).slice(0, 10)}{age(p.birth_date as string) !== null ? ` (${age(p.birth_date as string)} ${t('unit.years')})` : ''}</span>
              <span>📍 {fmtVal(p.wilaya_label)} {p.commune ? `· ${fmtVal(p.commune)}` : ''}</span>
              {p.blood_group ? <Badge tone="warn"><DropIcon /> {fmtVal(p.blood_group)}</Badge> : null}
              {p.ss_fund ? <Badge tone="info">{fmtVal(p.ss_fund)} · <span dir="ltr" className="font-mono">{fmtVal(p.ss_number)}</span></Badge> : null}
              {p.attending_name ? <span className="inline-flex items-center gap-1"><HeartPulse size={13} className="text-[rgb(var(--c-coral))]" /> {fmtVal(p.attending_name)}</span> : null}
            </div>
            {Array.isArray(p.allergies_json) && (p.allergies_json as string[]).length ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-xl bg-[rgb(var(--c-coral-soft))] px-2.5 py-1.5">
                <AlertTriangle size={14} className="text-[rgb(var(--c-coral))]" />
                <span className="text-[12px] font-bold text-[rgb(var(--c-coral))]">{t('field.allergies')} :</span>
                {(p.allergies_json as string[]).map((a) => (
                  <Badge key={a} tone="danger">{a}</Badge>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="ghost" title={t('actions.badge')} onClick={() => setQrOpen(true)}>
              <QrCode size={15} />
            </Button>
            <Button size="sm" variant="ghost" title={tc('print')} onClick={() => printHistory(p, fullName)}>
              <Printer size={15} />
            </Button>
            <Button size="sm" variant="ghost" title={t('actions.export')} onClick={() => void api.download(`/patients/${pid}/export`, `dossier-${p.code as string}.json`).catch(() => undefined)}>
              <Download size={15} />
            </Button>
            {has('patients', 'update') ? (
              <Button
                size="sm"
                variant={consent?.granted ? 'ok' : 'danger'}
                title={consent?.granted ? t('consent.granted') : t('consent.none')}
                onClick={() => consentMut.mutate(!consent?.granted)}
              >
                {consent?.granted ? <ShieldCheck size={15} /> : <ShieldX size={15} />}
                {consentMut.isPending ? '…' : consent?.granted ? t('consent.yes') : t('consent.no')}
              </Button>
            ) : null}
          </div>
        </Card>
      </motion.div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'history', label: t('tabs.history') },
          { key: 'records', label: t('tabs.records') },
          { key: 'ged', label: t('tabs.ged') },
          { key: 'workflow', label: t('tabs.workflow') },
          { key: 'movements', label: t('tabs.movements') },
          { key: 'appts', label: t('tabs.appointments') },
          { key: 'rx', label: t('tabs.rx') },
          { key: 'notes', label: t('tabs.notes') },
        ]}
      />

      {tab === 'history' ? <HistoryTab pid={pid} data={history.data?.rows ?? []} loading={history.isLoading} /> : null}
      {tab === 'records' ? <PatientRecords pid={pid} /> : null}
      {tab === 'ged' ? (
        <CrudModule
          resource="ged"
          title={t('tabs.ged')}
          search={false}
          scopeSelect
          canArchive={has('ged', 'archive')}
          canDelete={false}
          columns={[
            { key: 'code', label: tc('code'), width: '130px', render: (r) => <BizCode code={r.code as string} copy /> },
            { key: 'title', label: tc('title'), render: (r) => <span className="font-semibold">{fmtVal(r.title)}</span> },
            { key: 'type_label', label: t('ged.type'), width: '120px', render: (r) => <Badge>{fmtVal(r.type_label ?? r.type_prefix)}</Badge> },
            { key: 'file_size', label: tc('size'), width: '80px', hideByDefault: true, render: (r) => <span className="font-mono text-[12px]">{r.file_size ? `${Math.round(Number(r.file_size) / 1024)} Ko` : '—'}</span> },
            { key: 'created_at', label: tc('createdAt'), width: '140px', render: (r) => <span className="font-mono text-[11.5px] text-[rgb(var(--c-muted))]">{fmtVal(r.created_at).slice(0, 16)}</span> },
          ]}
          cardTitle={(r) => fmtVal(r.title)}
          cardSubtitle={(r) => <BizCode code={r.code as string} />}
          cardBadges={(r) => <Badge tone="info">{fmtVal(r.type_label ?? r.type_prefix)}</Badge>}
          extraQuery={{ patientId: pid }}
          rowMenu={(r) => (
            <button
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-[13px] font-medium hover:bg-[rgb(var(--c-surface-2))]"
              onClick={() => void api.download(`/ged/${r.id}/url`, 'doc').catch(() => undefined)}
            >
              <Download size={14} /> {t('ged.download')}
            </button>
          )}
          toolbarExtra={has('ged', 'create') ? <GedUpload pid={pid} onDone={() => void qc.invalidateQueries({ queryKey: ['list', 'ged'] })} /> : null}
        />
      ) : null}
      {tab === 'workflow' ? <WorkflowTab pid={pid} editable={has('patient_case', 'update')} /> : null}
      {tab === 'movements' ? <MovementsTab pid={pid} /> : null}
      {tab === 'appts' ? (
        <CrudModule
          resource="appointments"
          title={t('tabs.appointments')}
          search={false}
          canExport={false}
          defaultSort={{ id: 'start_at', desc: true }}
          columns={[
            { key: 'start_at', label: tc('date'), width: '150px', render: (r) => <span className="font-mono text-[12px]">{fmtVal(r.start_at).slice(0, 16).replace('T', ' ')}</span> },
            { key: 'kind', label: t('appt.kind'), width: '110px', render: (r) => <Badge tone="info">{fmtVal(r.kind)}</Badge> },
            { key: 'status', label: t('appt.statusField'), width: '110px', render: (r) => <Badge tone={r.status === 'done' ? 'ok' : r.status === 'cancelled' ? 'danger' : 'warn'}>{fmtVal(r.status)}</Badge> },
            { key: 'practitioner_name', label: t('appt.practitioner'), render: (r) => fmtVal(r.practitioner_name ?? '—') },
            { key: 'location_name', label: t('appt.location'), render: (r) => fmtVal(r.location_name ?? '—') },
            { key: 'notes', label: tc('notes'), hideByDefault: true },
          ]}
          cardTitle={(r) => `${fmtVal(r.start_at).slice(0, 16).replace('T', ' ')} — ${fmtVal(r.kind)}`}
          extraQuery={{ from: new Date(Date.now() - 120 * 86_400_000).toISOString() }}
          canCreate={has('calendar', 'create')}
          canDelete={has('calendar', 'delete')}
          canUpdate={has('calendar', 'update')}
          createLabel={t('appt.new')}
          fields={[
            { key: 'startAt', label: t('appt.start'), kind: 'datetime', required: true },
            { key: 'endAt', label: t('appt.end'), kind: 'datetime', required: true },
            { key: 'kind', label: t('appt.kind'), options: [{ value: 'consultation', label: t('appt.k.consultation') }, { value: 'control', label: t('appt.k.control') }, { value: 'procedure', label: t('appt.k.procedure') }], required: true },
            { key: 'status', label: t('appt.statusField'), kind: 'select', options: [
              { value: 'pending', label: t('appt.status.pending') },
              { value: 'confirmed', label: t('appt.status.confirmed') },
              { value: 'done', label: t('appt.status.done') },
              { value: 'cancelled', label: t('appt.status.cancelled') },
              { value: 'no_show', label: t('appt.status.no_show') },
            ] },
            { key: 'notes', label: tc('notes'), kind: 'textarea', colSpan: 2 },
          ]}
          transformCreate={(v) => ({ ...v, patientId: pid })}
          toolbarExtra={
            <Button size="sm" variant="ghost" onClick={() => router.push(`/calendar?patient=${pid}`)}>
              <CalendarPlus size={14} /> {t('appt.openCalendar')}
            </Button>
          }
        />
      ) : null}
      {tab === 'rx' ? (
        <CrudModule
          resource="prescriptions"
          title={t('tabs.rx')}
          search={false}
          canExport
          defaultSort={{ id: 'id', desc: true }}
          columns={[
            { key: 'code', label: tc('code'), width: '170px', render: (r) => <BizCode code={r.code as string} copy /> },
            { key: 'date', label: tc('date'), width: '100px', render: (r) => <span className="font-mono text-[12px]">{fmtVal(r.date ?? r.created_at).slice(0, 10)}</span> },
            { key: 'status', label: t('rx.status'), width: '100px', render: (r) => <Badge tone={r.status === 'validated' ? 'ok' : r.status === 'cancelled' ? 'danger' : 'warn'}>{fmtVal(r.status)}</Badge> },
            { key: 'practitioner_name', label: t('rx.prescriber'), render: (r) => fmtVal(r.practitioner_name ?? '—') },
            { key: 'lines_count', label: t('rx.lines'), width: '60px', hideByDefault: true, render: (r) => fmtVal((r.lines_json as unknown[])?.length ?? 0) },
          ]}
          cardTitle={(r) => `${t('rx.rx')} ${fmtVal(r.code)}`}
          cardBadges={(r) => <Badge tone={r.status === 'validated' ? 'ok' : 'warn'}>{fmtVal(r.status)}</Badge>}
          rowHref={(r) => `/prescriptions/${r.id}`}
          extraQuery={{ patientId: pid }}
          canCreate={has('prescriptions', 'create')}
          canUpdate={false}
          canDelete={false}
          createLabel={t('rx.new')}
          toolbarExtra={
            <Button size="sm" variant="primary" onClick={() => router.push(`/prescriptions/new?patient=${pid}`)}>
              {t('rx.new')}
            </Button>
          }
        />
      ) : null}
      {tab === 'notes' ? <NotesTab pid={pid} /> : null}

      <Dialog open={qrOpen} onClose={() => setQrOpen(false)} title={<span className="flex items-center gap-2"><QrCode size={16} /> {t('actions.badge')}</span>}>
        <div className="flex flex-col items-center gap-3 p-2 text-center">
          <div className="rounded-2xl bg-white p-3 shadow" dangerouslySetInnerHTML={{ __html: badge.data?.qr ?? '<div class="skeleton h-32 w-32" />' }} />
          <div dangerouslySetInnerHTML={{ __html: badge.data?.barcode ?? '' }} />
          <BizCode code={badge.data?.code ?? (p.code as string)} copy />
          <p className="text-[12px] text-[rgb(var(--c-muted))]">{t('badge.hint')}</p>
          {badge.data?.url ? <Input readOnly value={badge.data.url} onFocus={(e) => e.target.select()} /> : null}
          <Button variant="primary" size="sm" onClick={() => window.print()} disabled={!badge.data}>
            <Printer size={14} /> {tc('print')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function DropIcon(): React.ReactElement {
  return <Syringe size={11} />;
}

/** Impression de la fiche réduite (liste — pas de portail, fenêtre dédiée, LTR codes isolés). */
function printHistory(p: Record<string, unknown>, name: string): void {
  const rows: [string, string][] = [
    [String(p.code ?? ''), 'code'],
    [String(p.birth_date ?? ''), 'naissance'],
    [String(p.blood_group ?? ''), 'groupe'],
    [String(p.wilaya_label ?? ''), 'wilaya'],
    [String(p.ss_fund ?? ''), 'organisme'],
    [String(p.ss_number ?? ''), 'n° sécu'],
  ];
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title><style>
  body{font-family:Arial,Helvetica,sans-serif;margin:24px;color:#111}table{border-collapse:collapse}td,th{border:1px solid #999;padding:4px 8px;font-size:12px}.code{font-family:monospace;direction:ltr}
  </style></head><body><h2>Fiche patient — ${name}</h2><table><tbody>${rows
    .map((r) => `<tr><th>${r[1]}</th><td class="${r[1] === 'code' ? 'code' : ''}">${r[0] || '—'}</td></tr>`)
    .join('')}</tbody></table><script>window.onload=()=>window.print()</script></body></html>`;
  const w = window.open('', '_blank', 'width=720,height=640');
  if (w) {
    w.document.write(html);
    w.document.close();
  }
}

/* ------------------------------------------------ Antécédents */
function HistoryTab({ pid, data, loading }: { pid: number; data: { id: number; kind: string; at: string; ref_code: string | null; summary: Record<string, string> | null }[]; loading: boolean }): React.ReactElement {
  const { t } = useT('patient');
  const { lang } = useT('common');
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const add = useMutation({
    mutationFn: () => api.post(`/patients/${pid}/history`, { kind: 'note', summary: { [lang]: text } }),
    onSuccess: () => {
      setText('');
      void qc.invalidateQueries({ queryKey: ['history', pid] });
      toast.success('✓');
    },
    onError: () => {
      // variante via endpoint notes (le schéma ci-dessus peut varier)
      void api
        .post(`/patients/${pid}/notes`, { text, lang })
        .then(() => {
          setText('');
          void qc.invalidateQueries({ queryKey: ['history', pid] });
        })
        .catch(() => toast.error('!'));
    },
  });
  const KIND_ICON: Record<string, React.ReactNode> = {
    record: <Activity size={13} />,
    rx: <HeartPulse size={13} />,
    ged: <Download size={13} />,
    consent: <Shield size={13} />,
    note: <BadgeCheck size={13} />,
    movement: <WorkflowIcon size={13} />,
    case: <WorkflowIcon size={13} />,
  };
  return (
    <Card className="flex flex-col gap-3">
      {loading ? <div className="skeleton h-40" /> : !data.length ? <EmptyState icon={Activity} title={t('history.empty')} /> : null}
      <ul className="relative flex flex-col gap-0">
        {data.map((ev, i) => (
          <motion.li key={ev.id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 15) * 0.02 }} className="relative flex items-start gap-3 border-s-2 border-[rgb(var(--c-line))] py-2 ltr:ps-4 rtl:pe-4 rtl:border-s-0 rtl:border-e-2">
            <span className="absolute top-3 grid h-6 w-6 -translate-x-1/2 place-items-center rounded-full border border-[rgb(var(--c-line))] bg-[rgb(var(--c-surface))] text-[rgb(var(--c-primary))] ltr:left-0 rtl:left-auto rtl:-translate-x-[-50%] rtl:translate-x-1/2 rtl:right-0 rtl:border-e-0">
              {KIND_ICON[ev.kind] ?? <BadgeCheck size={12} />}
            </span>
            <span className="mt-0.5 shrink-0 font-mono text-[11.5px] text-[rgb(var(--c-muted))]">{fmtVal(ev.at).slice(0, 10)}</span>
            <span className="min-w-0 flex-1 text-[13px]">{pickAny(ev.summary, lang)}</span>
            {ev.ref_code ? <BizCode code={ev.ref_code} /> : null}
          </motion.li>
        ))}
      </ul>
      <div className="flex items-end gap-2 border-t border-[rgb(var(--c-line)/0.6)] pt-3">
        <Field className="flex-1" label={t('notes.add')}>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} />
        </Field>
        <Button variant="primary" disabled={text.trim().length < 2} loading={add.isPending} onClick={() => add.mutate()}>
          +
        </Button>
      </div>
    </Card>
  );
}

function pickAny(s: Record<string, string> | null, lang: string): string {
  if (!s) return '';
  return s[lang] ?? s.fr ?? s.en ?? s.ar ?? s.es ?? Object.values(s)[0] ?? '';
}

/* ------------------------------------------------ Circuit de soins */
interface Step {
  key: string;
  label: Record<string, string> | string;
  color?: string;
  status: 'todo' | 'in_progress' | 'done' | 'skipped';
  done_at: string | null;
  note: string | null;
}
function WorkflowTab({ pid, editable }: { pid: number; editable: boolean }): React.ReactElement {
  const { t } = useT('patient');
  const { lang } = useT('common');
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['case', pid], queryFn: () => api.get<{ case: { id: number; code: string; status: string; current_step?: string } | null; steps: Step[] }>(`/cases/current?patientId=${pid}`) });
  const [adv, setAdv] = useState<{ stepKey: string; note: string } | null>(null);
  const advance = useMutation({
    mutationFn: () => api.post('/cases/advance', { caseId: q.data?.case?.id, stepKey: adv?.stepKey, status: 'done', note: adv?.note || undefined }),
    onSuccess: () => {
      toast.success(t('workflow.advanced'));
      setAdv(null);
      void qc.invalidateQueries({ queryKey: ['case', pid] });
    },
    onError: (e: unknown) => toast.error(t(`errors.${(e as { code?: string }).code ?? 'network'}`)),
  });
  if (q.isLoading) return <Card><div className="skeleton h-24" /></Card>;
  const steps = q.data?.steps ?? [];
  const stepLabel = (s: Step): string => (typeof s.label === 'string' ? s.label : pickAny(s.label as Record<string, string>, lang) || s.key);
  return (
    <Card className="flex flex-col gap-4 overflow-x-auto">
      <div className="flex min-w-max items-center gap-2">
        {steps.map((s, i) => {
          const done = s.status === 'done';
          const cur = q.data?.case?.current_step === s.key;
          return (
            <React.Fragment key={s.key}>
              <div className="flex flex-col items-center gap-1">
                <motion.button
                  whileTap={{ scale: 0.92 }}
                  onClick={() => editable && !done && setAdv({ stepKey: s.key, note: '' })}
                  className={done ? 'text-[rgb(var(--c-primary))]' : cur ? 'text-[rgb(var(--c-amber))]' : ''}
                >
                  <motion.span
                    animate={cur ? { scale: [1, 1.12, 1] } : {}}
                    transition={{ repeat: Infinity, duration: 2.4 }}
                    className={`grid h-11 w-11 place-items-center rounded-2xl border-2 font-bold ${done ? 'border-[rgb(var(--c-ok))] bg-[rgb(var(--c-ok-soft))] text-[rgb(var(--c-ok))]' : cur ? 'border-[rgb(var(--c-amber))] bg-[rgb(var(--c-amber-soft))] text-[rgb(var(--c-amber))]' : 'border-[rgb(var(--c-line))] bg-[rgb(var(--c-surface))] text-[rgb(var(--c-muted))]'}`}
                  >
                    {done ? '✓' : i + 1}
                  </motion.span>
                </motion.button>
                <span className={`max-w-[110px] text-center text-[11.5px] font-semibold ${cur ? 'text-[rgb(var(--c-amber))]' : ''}`}>{stepLabel(s)}</span>
                {s.done_at ? <span className="font-mono text-[10px] text-[rgb(var(--c-muted))]">{fmtVal(s.done_at).slice(5, 10)}</span> : null}
              </div>
              {i < steps.length - 1 ? <div className={`h-0.5 w-10 rounded ${done ? 'bg-[rgb(var(--c-ok))]' : 'bg-[rgb(var(--c-line))]'}`} /> : null}
            </React.Fragment>
          );
        })}
      </div>
      {q.data?.case ? (
        <div className="flex items-center gap-2 text-[12.5px] text-[rgb(var(--c-muted))]">
          <BizCode code={q.data.case.code} copy /> <Badge tone={q.data.case.status === 'closed' ? 'neutral' : 'info'}>{q.data.case.status}</Badge>
        </div>
      ) : (
        <p className="text-[12.5px] text-[rgb(var(--c-muted))]">{t('workflow.none')}</p>
      )}
      <Dialog
        open={Boolean(adv)}
        onClose={() => setAdv(null)}
        title={`${t('workflow.markDone')} — ${adv?.stepKey ?? ''}`}
        footer={
          <>
            <Button onClick={() => setAdv(null)}>{t('cancel')}</Button>
            <Button variant="primary" loading={advance.isPending} onClick={() => advance.mutate()}>
              {t('save')}
            </Button>
          </>
        }
      >
        <Field label={tc_note()}>
          <Textarea rows={3} value={adv?.note ?? ''} onChange={(e) => setAdv((a) => (a ? { ...a, note: e.target.value } : a))} />
        </Field>
      </Dialog>
    </Card>
  );
}
function tc_note(): string {
  return 'note';
}

/* ------------------------------------------------ Mouvements */
function MovementsTab({ pid }: { pid: number }): React.ReactElement {
  const { t } = useT('patient');
  const { t: tc } = useT('common');
  const has = useAuth((s) => s.has);
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ rows: { id: number; code: string; name: string }[] }>('/locations?pageSize=100') });
  const locOptions = useMemo(() => (locations.data?.rows ?? []).map((l) => ({ value: String(l.id), label: `${l.code} — ${l.name}` })), [locations.data]);
  return (
    <CrudModule
      resource="movements"
      title={t('tabs.movements')}
      search={false}
      canExport={false}
      defaultSort={{ id: 'id', desc: true }}
      columns={[
        { key: 'code', label: tc('code'), width: '120px', render: (r) => <BizCode code={r.code as string} /> },
        { key: 'at', label: tc('date'), width: '150px', render: (r) => <span className="font-mono text-[12px]">{fmtVal(r.at ?? r.created_at).slice(0, 16).replace('T', ' ')}</span> },
        { key: 'from_location', label: t('mov.from'), render: (r) => fmtVal(r.from_location_name ?? r.from_location ?? '—') },
        { key: 'to_location', label: t('mov.to'), render: (r) => fmtVal(r.to_location_name ?? r.to_location ?? '—') },
        { key: 'status', label: t('mov.status'), width: '110px', render: (r) => <Badge tone={r.status === 'arrived' ? 'ok' : 'warn'}>{fmtVal(r.status)}</Badge> },
        { key: 'reason', label: t('mov.reason'), hideByDefault: false },
      ]}
      cardTitle={(r) => `${fmtVal(r.from_location_name ?? '—')} → ${fmtVal(r.to_location_name ?? '—')}`}
      extraQuery={{ patientId: pid }}
      canCreate={has('workflow', 'update')}
      canUpdate={false}
      canDelete={false}
      createLabel={t('mov.new')}
      fields={[
        { key: 'toLocationId', label: t('mov.to'), kind: 'select', options: locOptions, required: true },
        { key: 'fromLocationId', label: t('mov.from'), kind: 'select', options: [{ value: '', label: '—' }, ...locOptions] },
        { key: 'status', label: t('mov.status'), kind: 'select', options: [{ value: 'pending', label: t('mov.pending') }, { value: 'in_transit', label: t('mov.transit') }, { value: 'arrived', label: t('mov.arrived') }] },
        { key: 'reason', label: t('mov.reason') },
        { key: 'at', label: tc('date'), kind: 'datetime' },
      ]}
      transformCreate={(v) => ({ ...v, patientId: pid, toLocationId: Number(v.toLocationId), fromLocationId: v.fromLocationId ? Number(v.fromLocationId) : null })}
    />
  );
}

/* ------------------------------------------------ Notes libres */
function NotesTab({ pid }: { pid: number }): React.ReactElement {
  const { t } = useT('patient');
  const { lang } = useT('common');
  const toast = useToast();
  const [text, setText] = useState('');
  const add = useMutation({
    mutationFn: () => api.post(`/patients/${pid}/notes`, { text, lang }),
    onSuccess: () => {
      setText('');
      toast.success(t('saved'));
    },
  });
  return (
    <Card className="flex flex-col gap-2">
      <p className="text-[12px] text-[rgb(var(--c-muted))]">{t('notes.hint')}</p>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder={t('notes.placeholder')} />
      <div className="flex justify-end">
        <Button variant="primary" disabled={text.trim().length < 2} loading={add.isPending} onClick={() => add.mutate()}>
          {t('notes.add')}
        </Button>
      </div>
    </Card>
  );
}

/* ------------------------------------------------ Upload GED inline */
function GedUpload({ pid, onDone }: { pid: number; onDone: () => void }): React.ReactElement {
  const { t } = useT('patient');
  const { t: tc } = useT('common');
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [type, setType] = useState('DOC');
  const [file, setFile] = useState<File | null>(null);
  const types = useQuery({ queryKey: ['ged-types'], queryFn: () => api.get<{ rows: { prefix: string; label: string }[] }>('/ged/meta/types') });
  const up = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.set('typePrefix', type);
      fd.set('title', title || (file?.name ?? 'Document'));
      fd.set('patientId', String(pid));
      if (file) fd.set('file', file);
      return api.upload<{ row: { code: string } }>('/ged/upload', fd);
    },
    onSuccess: () => {
      toast.success(tc('saved'));
      setOpen(false);
      setFile(null);
      setTitle('');
      onDone();
    },
    onError: () => toast.error(t('ged.uploadError')),
  });
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Upload size={14} /> {t('ged.upload')}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('ged.upload')}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>{tc('cancel')}</Button>
            <Button variant="primary" loading={up.isPending} disabled={!file} onClick={() => up.mutate()}>
              {tc('save')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label={t('ged.type')}>
            <Select value={type} onChange={(e) => setType(e.target.value)} options={(types.data?.rows ?? []).map((x) => ({ value: x.prefix, label: `${x.prefix} — ${x.label}` }))} />
          </Field>
          <Field label={tc('title')}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={file?.name} />
          </Field>
          <Field label={tc('file')} required>
            <input
              type="file"
              className="field"
              accept="image/*,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Field>
        </div>
      </Dialog>
    </>
  );
}

/* ------------------------------------------------ Enregistrements (liste toutes catégories) */
/** Bloc « Fiches » du dossier patient — export NON public : un page.tsx Next ne doit exporter que default + config de page. */
function PatientRecords({ pid }: { pid: number }): React.ReactElement {
  const { t } = useT('patient');
  const { t: tc } = useT('common');
  const router = useRouter();
  const q = useQuery({ queryKey: ['pat-records', pid], queryFn: () => api.get<{ rows: Record<string, unknown>[] }>(`/patients/${pid}/records`) });
  if (q.isLoading) return <Card><div className="skeleton h-40" /></Card>;
  const rows = q.data?.rows ?? [];
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[14px] font-bold">{t('tabs.records')}</h3>
        <Button size="sm" variant="primary" onClick={() => router.push('/records')}>
          {t('records.newHere')}
        </Button>
      </div>
      {!rows.length ? <EmptyState icon={Activity} title={t('records.empty')} /> : null}
      {rows.map((r, i) => (
        <motion.button
          key={String(r.id)}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: Math.min(i, 12) * 0.02 }}
          onClick={() => router.push(`/records/${fmtVal(r.category_module ?? r.category)}/${r.id}`)}
          className="flex items-center gap-3 rounded-xl border border-[rgb(var(--c-line)/0.6)] p-2.5 text-start transition-colors hover:bg-[rgb(var(--c-primary-soft)/0.4)]"
        >
          <Badge tone="info">{fmtVal(r.category_prefix)}</Badge>
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{fmtVal(r.title ?? r.summary) || tc('untitled')}</span>
          <span className="font-mono text-[11.5px] text-[rgb(var(--c-muted))]">{fmtVal(r.act_date).slice(0, 10)}</span>
          <BizCode code={r.code as string} />
          <span className={`badge ${r.status === 'validated' ? 'text-[rgb(var(--c-ok))]' : 'text-[rgb(var(--c-muted))]'}`}>{fmtVal(r.status)}</span>
        </motion.button>
      ))}
    </Card>
  );
}
