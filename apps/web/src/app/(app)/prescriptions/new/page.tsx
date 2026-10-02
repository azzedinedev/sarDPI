'use client';
/**
 * Éditeur d’ordonnance — lignes médicaments (recherche dans le catalogue pharmacie), posologies,
 * contrôles ALLERGIE + INTERACTIONS (avertissements non bloquants), modèles (templates) par praticien,
 * sauvegarde → redirection vers la fiche avec impression PDF (serveur) et QR de vérification.
 */
import React, { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { AlertTriangle, Plus, Save, Search, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Badge, Button, Field, Input, Select, Spinner, Textarea } from '@/components/ui';
import { useToast } from '@/components/toast';
import { useAuth } from '@/stores/auth';

interface DrugHit {
  id: number;
  code: string;
  dci: string;
  trade_name: string;
  forms: string | null;
  strengths: string | null;
  atc: string | null;
}
interface Line {
  key: number;
  drugId: number | null;
  dci: string;
  tradeName: string;
  form: string;
  dosage: string;
  quantity: number;
  posology: string;
  durationDays: number;
  instructions: string;
}

let lineSeq = 1;

export default function RxNewPage(): React.ReactElement {
  const router = useRouter();
  const sp = useSearchParams();
  const { t } = useT('patient');
  const { t: tc } = useT('common');
  const toast = useToast();
  const qc = useQueryClient();
  const has = useAuth((s) => s.has);
  const editId = sp.get('id') ? Number(sp.get('id')) : null; // mode édition d'une ordonnance existante
  const isAdmin = has('prescriptions', 'validate');

  const [patientQuery, setPatientQuery] = useState('');
  const [patient, setPatient] = useState<{ id: number; code: string; full_name: string } | null>(null);
  const [practitionerId, setPractitionerId] = useState<number | ''>('');
  const [templateId, setTemplateId] = useState<number | ''>('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [refills, setRefills] = useState(0);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([{ key: lineSeq++, drugId: null, dci: '', tradeName: '', form: '', dosage: '', quantity: 1, posology: '', durationDays: 7, instructions: '' }]);
  const [drugSearch, setDrugSearch] = useState('');

  const patSearch = useQuery({ queryKey: ['rx-pat', patientQuery], queryFn: () => api.get<{ rows: { id: number; code: string; full_name: string }[] }>(`/patients/search?q=${encodeURIComponent(patientQuery)}`), enabled: patientQuery.length >= 2 });
  const practs = useQuery({ queryKey: ['pract-lite'], queryFn: () => api.get<{ rows: { id: number; code: string; last_name: string; first_name: string }[] }>('/practitioners?pageSize=100&active=true&typePrefix=MED') });
  const templates = useQuery({ queryKey: ['rx-templates'], queryFn: () => api.get<{ rows: { id: number; name: string; practitioner_id: number | null }[] }>('/rx-templates?pageSize=50') });
  const drugs = useQuery({ queryKey: ['drug-search', drugSearch], queryFn: () => api.get<{ rows: DrugHit[] }>(`/drugs/search?q=${encodeURIComponent(drugSearch)}`), enabled: drugSearch.length >= 2 });

  // ordonnance chargée en édition (statut/verrou + lignes)
  const loaded = useQuery({
    queryKey: ['rx', editId],
    enabled: Boolean(editId),
    queryFn: () =>
      api.get<{
        id: number; code: string | null; status: string; act_date?: string; notes?: string | null; refills?: number;
        locked_at?: string | null; practitioner_id?: number; patient_id?: number;
        patient?: { code: string; last_name: string; first_name: string } | null;
        lines?: { drug_id?: number | null; dci?: string | null; trade_name: string; form?: string | null; dosage?: string | null; quantity: number; posology: string; duration_days: number; instructions?: string | null }[];
      }>(`/prescriptions/${editId}`),
  });
  const locked = Boolean(loaded.data?.locked_at) || loaded.data?.status === 'validated';
  const readOnly = Boolean(editId) && locked && !isAdmin;
  const [hydrated, setHydrated] = useState(false);
  React.useEffect(() => {
    if (!editId || !loaded.data || hydrated) return;
    const rx = loaded.data;
    if (rx.patient) setPatient({ id: Number(rx.patient_id), code: rx.patient.code, full_name: `${rx.patient.first_name ?? ''} ${rx.patient.last_name ?? ''}`.trim() });
    if (rx.practitioner_id) setPractitionerId(Number(rx.practitioner_id));
    if (rx.act_date) setDate(String(rx.act_date).slice(0, 10));
    setRefills(Number(rx.refills ?? 0));
    setNotes(rx.notes ?? '');
    if (rx.lines?.length) setLines(rx.lines.map((l) => ({ key: lineSeq++, drugId: l.drug_id ?? null, dci: l.dci ?? '', tradeName: l.trade_name, form: l.form ?? '', dosage: l.dosage ?? '', quantity: Number(l.quantity ?? 1), posology: l.posology ?? '', durationDays: Number(l.duration_days ?? 7), instructions: l.instructions ?? '' })));
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, loaded.data, hydrated]);

  const check = useMutation({
    mutationFn: () => api.post<{ warnings: { kind: 'allergy' | 'interaction'; text: string }[] }>('/prescriptions/check', { patientId: patient?.id, lines: lines.map((l) => ({ dci: l.dci, tradeName: l.tradeName })) }),
  });

  const warnings = check.data?.warnings;
  const valid = useMemo(() => patient && practitionerId && lines.every((l) => l.tradeName && l.posology) && lines.length > 0, [patient, practitionerId, lines]);

  const save = useMutation({
    mutationFn: async () => {
      const payloadLines = lines.map((l) => ({ drugId: l.drugId, dci: l.dci || null, tradeName: l.tradeName, form: l.form || null, dosage: l.dosage || null, quantity: l.quantity, posology: l.posology, durationDays: l.durationDays, instructions: l.instructions || null }));
      if (editId) {
        await api.put(`/prescriptions/${editId}`, { practitionerId: Number(practitionerId), actDate: date, refills, notes: notes || null, lines: payloadLines });
        return { id: editId };
      }
      return await api.post<{ id: number }>('/prescriptions', {
        patientId: patient?.id,
        practitionerId: Number(practitionerId),
        templateId: templateId ? Number(templateId) : null,
        actDate: date,
        refills,
        notes: notes || null,
        lines: payloadLines,
      });
    },
    onSuccess: (r) => {
      toast.success(tc('saved'));
      void qc.invalidateQueries({ queryKey: ['rx', r.id] });
      void qc.invalidateQueries({ queryKey: ['list', 'prescriptions'] });
      router.push(`/prescriptions/${r.id}`);
    },
    onError: (e: unknown) => {
      const code = (e as { code?: string }).code ?? 'network';
      toast.error(code === 'errors.locked' ? t('errors.locked') : t(`errors.${code}`));
    },
  });

  const preselect = sp.get('patient');
  React.useEffect(() => {
    if (preselect && !patient) {
      void api.get<{ rows: { id: number; code: string; full_name: string }[] }>(`/patients/search?q=${encodeURIComponent(preselect)}`).then((r) => {
        const hit = r.rows.find((x) => x.id === Number(preselect));
        if (hit) setPatient(hit);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselect]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="glass-card flex flex-wrap items-center gap-3 p-4">
          <h1 className="text-[19px] font-bold">{editId ? t('rx.edit') : t('rx.new')}</h1>
          {editId && loaded.data?.code ? <Badge tone="info">{loaded.data.code}</Badge> : null}
          {locked ? <Badge tone={isAdmin ? 'warn' : 'danger'}>{t('rx.lockedBadge')}</Badge> : null}
          <div className="ms-auto flex gap-2">
            <Button variant="ghost" onClick={() => check.mutate()} disabled={!patient || !lines.length}>
              <AlertTriangle size={14} /> {t('rx.check')}
            </Button>
            <Button variant="primary" loading={save.isPending} disabled={!valid || readOnly} onClick={() => save.mutate()}>
              <Save size={15} /> {tc('save')}
            </Button>
          </div>
        </div>
        {readOnly ? (
          <p className="mt-2 rounded-xl bg-[rgb(var(--c-coral-soft))] px-3 py-2 text-[12.5px] font-bold text-[rgb(var(--c-coral))]">{t('rx.lockedHint')}</p>
        ) : null}
      </motion.div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="glass-card flex flex-col gap-2 p-4">
          <Field label={t('rx.patient')} required>
            {patient ? (
              <div className="flex items-center gap-2 rounded-xl bg-[rgb(var(--c-primary-soft))] px-3 py-2 text-[13px] font-bold">
                <span dir="ltr" className="font-mono text-[11.5px]">{patient.code}</span> {patient.full_name}
                <button className="ms-auto opacity-60 hover:opacity-100" onClick={() => setPatient(null)}>✕</button>
              </div>
            ) : (
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-[rgb(var(--c-muted))] ltr:left-2.5 rtl:right-2.5" />
                <Input autoFocus className="ps-8" value={patientQuery} onChange={(e) => setPatientQuery(e.target.value)} placeholder={t('list.searchPlaceholder')} />
              </div>
            )}
          </Field>
          {!patient && patientQuery.length >= 2 ? (
            <div className="max-h-44 overflow-y-auto rounded-xl border border-[rgb(var(--c-line))]">
              {(patSearch.data?.rows ?? []).map((p) => (
                <button key={p.id} className="flex w-full items-center justify-between px-3 py-2 text-[13px] hover:bg-[rgb(var(--c-surface-2))]" onClick={() => setPatient(p)}>
                  <span>{p.full_name}</span>
                  <span dir="ltr" className="font-mono text-[11px]">{p.code}</span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('rx.prescriber')} required>
              <Select value={practitionerId} onChange={(e) => setPractitionerId(e.target.value ? Number(e.target.value) : '')} options={[{ value: '', label: '—' }, ...(practs.data?.rows ?? []).map((x) => ({ value: String(x.id), label: `${x.last_name} ${x.first_name}` }))]} />
            </Field>
            <Field label={t('rx.template')}>
              <Select value={templateId} onChange={(e) => setTemplateId(e.target.value ? Number(e.target.value) : '')} options={[{ value: '', label: t('rx.noTemplate') }, ...(templates.data?.rows ?? []).map((x) => ({ value: String(x.id), label: x.name }))]} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label={tc('date')}>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label={t('rx.refills')}>
              <Input type="number" min={0} max={12} value={refills} onChange={(e) => setRefills(Number(e.target.value))} />
            </Field>
          </div>
          <Field label={tc('notes')}>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>

        {/* Avertissements */}
        <div className="glass-card flex flex-col gap-2 p-4">
          <h3 className="text-[13.5px] font-bold">{t('rx.alerts')}</h3>
          {check.isPending ? <Spinner /> : null}
          {!warnings && !check.isPending ? <p className="text-[12px] text-[rgb(var(--c-muted))]">{t('rx.checkHint')}</p> : null}
          {warnings?.filter((w) => w.kind === 'allergy').map((w) => (
            <p key={w.text} className="rounded-xl bg-[rgb(var(--c-coral-soft))] px-3 py-2 text-[12.5px] font-bold text-[rgb(var(--c-coral))]">⚠ {w.text}</p>
          ))}
          {warnings?.filter((w) => w.kind === 'interaction').map((w) => (
            <p key={w.text} className="rounded-xl bg-[rgb(var(--c-amber-soft))] px-3 py-2 text-[12.5px] font-bold text-[rgb(var(--c-amber))]">⚠ {w.text}</p>
          ))}
          {warnings && warnings.length === 0 ? <p className="rounded-xl bg-[rgb(var(--c-ok-soft))] px-3 py-2 text-[12.5px] font-bold text-[rgb(var(--c-ok))]">✓ {t('rx.noWarnings')}</p> : null}
        </div>
      </div>

      {/* Lignes */}
      <div className="glass-card flex flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[13.5px] font-bold">{t('rx.lines')} ({lines.length}/30)</h3>
          <div className="relative ms-auto w-64">
            <Input size={12} value={drugSearch} onChange={(e) => setDrugSearch(e.target.value)} placeholder={t('rx.searchDrug')} />
            {drugs.data && drugSearch.length >= 2 ? (
              <div className="absolute inset-x-0 top-10 z-20 max-h-52 overflow-y-auto rounded-xl border border-[rgb(var(--c-line))] bg-[rgb(var(--c-surface))] shadow-[var(--shadow-lift)]">
                {(drugs.data.rows ?? []).map((d) => (
                  <button
                    key={d.id}
                    className="flex w-full items-center gap-2 px-3 py-2 text-start text-[12.5px] hover:bg-[rgb(var(--c-surface-2))]"
                    onClick={() => {
                      setLines((ls) => {
                        const last = ls[ls.length - 1];
                        const line: Line = { key: lineSeq++, drugId: d.id, dci: d.dci, tradeName: d.trade_name, form: (d.forms ?? '').split(',')[0] ?? '', dosage: (d.strengths ?? '').split(',')[0] ?? '', quantity: 1, posology: '', durationDays: 7, instructions: '' };
                        if (last && !last.tradeName) return [...ls.slice(0, -1), line];
                        return [...ls, line];
                      });
                      setDrugSearch('');
                    }}
                  >
                    <b>{d.trade_name}</b>
                    <span className="text-[rgb(var(--c-muted))]">{d.dci}</span>
                    <span dir="ltr" className="ms-auto font-mono text-[10.5px]">{d.code}</span>
                  </button>
                ))}
                {!drugs.data.rows.length ? <p className="p-3 text-[12px] text-[rgb(var(--c-muted))]">{t('rx.drugNotFound')}</p> : null}
              </div>
            ) : null}
          </div>
          <Button size="sm" variant="ghost" onClick={() => setLines((l) => [...l, { key: lineSeq++, drugId: null, dci: '', tradeName: '', form: '', dosage: '', quantity: 1, posology: '', durationDays: 7, instructions: '' }])}>
            <Plus size={13} /> {t('rx.freeLine')}
          </Button>
        </div>

        {lines.map((l, i) => (
          <RxLine
            key={l.key}
            line={l}
            index={i}
            onChange={(patch) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, ...patch } : x)))}
            onRemove={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
            removable={lines.length > 1}
          />
        ))}
      </div>
    </div>
  );
}

function RxLine({ line, index, onChange, onRemove, removable }: { line: Line; index: number; onChange: (p: Partial<Line>) => void; onRemove: () => void; removable: boolean }): React.ReactElement {
  const { t } = useT('patient');
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-1.5 rounded-2xl border border-[rgb(var(--c-line)/0.7)] p-2.5">
      <div className="grid grid-cols-[28px_1fr_1fr_110px_90px_70px_32px] items-center gap-1.5 max-md:grid-cols-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-[rgb(var(--c-primary)/0.12)] font-mono text-[12px] font-bold text-[rgb(var(--c-primary))]">{index + 1}</span>
        <Input placeholder={t('rx.tradeName')} value={line.tradeName} onChange={(e) => onChange({ tradeName: e.target.value })} className="!min-h-8 !py-1 text-[12.5px]" />
        <Input placeholder="DCI" value={line.dci} onChange={(e) => onChange({ dci: e.target.value })} className="!min-h-8 !py-1 text-[12.5px]" />
        <Input placeholder={t('rx.form')} value={line.form} onChange={(e) => onChange({ form: e.target.value })} className="!min-h-8 !py-1 text-[12.5px]" />
        <Input placeholder={t('rx.dosage')} value={line.dosage} onChange={(e) => onChange({ dosage: e.target.value })} className="!min-h-8 !py-1 text-[12.5px]" />
        <Input type="number" min={1} max={999} value={line.quantity} onChange={(e) => onChange({ quantity: Number(e.target.value) })} className="!min-h-8 !py-1 text-[12.5px]" />
        <button className="btn btn-ghost btn-sm btn-icon text-[rgb(var(--c-coral))]" disabled={!removable} onClick={onRemove}>
          <Trash2 size={13} />
        </button>
      </div>
      <div className="grid grid-cols-[1fr_130px_1fr] gap-1.5 max-md:grid-cols-2">
        <Input placeholder={t('rx.posology')} required value={line.posology} onChange={(e) => onChange({ posology: e.target.value })} className="!min-h-8 !py-1 text-[12.5px]" />
        <div className="flex items-center gap-1">
          <Input type="number" min={1} max={365} value={line.durationDays} onChange={(e) => onChange({ durationDays: Number(e.target.value) })} className="!min-h-8 !py-1 text-[12.5px]" />
          <span className="text-[11px] text-[rgb(var(--c-muted))]">{t('unit.days')}</span>
        </div>
        <Input placeholder={t('rx.instructions')} value={line.instructions} onChange={(e) => onChange({ instructions: e.target.value })} className="!min-h-8 !py-1 text-[12.5px]" />
      </div>
    </motion.div>
  );
}
