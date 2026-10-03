'use client';

/**
 * CaseStepper — circuit de soins d'un dossier (patient_cases).
 * Réutilisable : soit par patient (pid → dossier de suivi global), soit par dossier précis (caseId).
 * La fiche d'étape (statut/date/lieu/intervenants/note) pilote POST /cases/advance ;
 * l'annulation d'une étape repasse le statut à « todo » (libellé d'historique « annulée »).
 */
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { FormProvider, useForm } from 'react-hook-form';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useToast } from '@/components/toast';
import { useFmtDate } from '@/lib/display';
import { Badge, Button, Field, Input, Select, Textarea } from '@/components/ui';
import { Dialog } from '@/components/dialogs';
import { BizCode } from '@/components/biz-code';
import { Card } from '@/components/crud';
import { Multiselect } from '@/components/combo';

export interface Step {
  key: string;
  label: Record<string, string> | string;
  color?: string;
  status: 'todo' | 'in_progress' | 'done' | 'skipped';
  done_at: string | null;
  note: string | null;
  location_id?: number | null;
  practitioners?: unknown[];
}

function pickAny(s: Record<string, string> | string | null | undefined, lang: string): string {
  if (!s) return '';
  if (typeof s === 'string') return s;
  return s[lang] ?? s.fr ?? s.en ?? s.ar ?? s.es ?? Object.values(s)[0] ?? '';
}

export function CaseStepper({ pid, caseId, editable }: { pid: number; caseId?: number | null; editable: boolean }): React.ReactElement {
  const { t } = useT('patient');
  const { lang } = useT('common');
  const toast = useToast();
  const qc = useQueryClient();
  const fmt = useFmtDate();
  const methods = useForm<Record<string, unknown>>({ defaultValues: { status: 'done', at: '', locationId: '', practitionerIds: [], note: '' } });
  // caseId fourni → ce dossier précis ; sinon le dossier de suivi global du patient
  const qUrl = caseId ? `/cases/current?caseId=${caseId}` : `/cases/current?patientId=${pid}`;
  // clés distinctes patient/dossier : pid et caseId sont des espaces d'ids différents qui peuvent se chevaucher
  const qKey = caseId ? ['case', 'dossier', caseId] : ['case', 'patient', pid];
  const q = useQuery({ queryKey: qKey, queryFn: () => api.get<{ case: { id: number; code: string; status: string; current_step?: string } | null; steps: Step[] }>(qUrl) });
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ rows: { id: number; code: string; name: string }[] }>('/locations?pageSize=100') });
  const practitioners = useQuery({ queryKey: ['practitioners', 'opts'], queryFn: () => api.get<{ rows: Record<string, unknown>[] }>('/practitioners?pageSize=100') });
  const [fiche, setFiche] = useState<{ stepKey: string; label: string } | null>(null);
  const createdRef = React.useRef<number | null>(null);
  const stepLabelOf = (s: Step): string => (typeof s.label === 'string' ? s.label : pickAny(s.label as Record<string, string>, lang) || s.key);
  const nowLocal = (): string => {
    const d = new Date();
    const p = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const refresh = (): void => {
    void qc.invalidateQueries({ queryKey: ['case'] });
    void qc.invalidateQueries({ queryKey: ['dossiers', pid] });
    void qc.invalidateQueries({ queryKey: ['dossier', caseId ?? q.data?.case?.id] });
    void qc.invalidateQueries({ queryKey: ['list', 'patients'] });
  };

  // Le workflow suit le dossier du patient : si aucun circuit n'existe encore, on le crée
  // (première étape = celle sur laquelle l'utilisateur clique) puis on ouvre la fiche de l'étape.
  const ensureCase = async (stepKey?: string): Promise<void> => {
    if (q.data?.case || createdRef.current) return;
    try {
      const r = await api.post<{ id: number; alreadyOpen: boolean }>('/cases', { patientId: pid, ...(stepKey ? { firstStep: stepKey } : {}) });
      createdRef.current = r.id;
      if (!r.alreadyOpen) toast.success(t('workflow.caseCreated'));
      refresh();
    } catch (e) {
      toast.error(t(`errors.${(e as { code?: string }).code ?? 'network'}`));
      throw e;
    }
  };

  const openStep = (s: Step): void => {
    if (!editable) return;
    void (async () => {
      try {
        await ensureCase(s.key);
        const st = ['done', 'in_progress', 'skipped', 'todo'].includes(String(s.status)) ? String(s.status) : 'done';
        methods.reset({ status: st, at: s.done_at ? String(s.done_at).slice(0, 16) : nowLocal(), locationId: s.location_id ? String(s.location_id) : '', practitionerIds: Array.isArray(s.practitioners) ? (s.practitioners as unknown[]).map(String) : [], note: s.note ?? '' });
        setFiche({ stepKey: s.key, label: stepLabelOf(s) });
      } catch {
        /* toast déjà émis par ensureCase */
      }
    })();
  };

  // annulation d'une étape : statut « todo », le current_step revient dessus (côté serveur) + historique
  const cancelStep = useMutation({
    mutationFn: async (s: Step) => {
      await ensureCase(s.key);
      return api.post('/cases/advance', { caseId: q.data?.case?.id ?? createdRef.current, stepKey: s.key, status: 'todo', note: null, at: null });
    },
    onSuccess: () => {
      toast.success(t('workflow.stepCancelled'));
      createdRef.current = null;
      refresh();
    },
    onError: (e: unknown) => toast.error(t(`errors.${(e as { code?: string }).code ?? 'network'}`)),
  });

  const save = useMutation({
    mutationFn: () => {
      const v = methods.getValues();
      return api.post('/cases/advance', {
        caseId: q.data?.case?.id ?? createdRef.current,
        stepKey: fiche?.stepKey,
        status: String(v.status ?? 'done'),
        note: typeof v.note === 'string' && v.note.trim() ? v.note.trim() : null,
        locationId: v.locationId ? Number(v.locationId) : null,
        practitionerIds: Array.isArray(v.practitionerIds) ? (v.practitionerIds as unknown[]).map(Number) : [],
        at: v.at ? new Date(String(v.at)).toISOString() : null,
      });
    },
    onSuccess: () => {
      toast.success(t('workflow.advanced'));
      setFiche(null);
      createdRef.current = null;
      refresh();
    },
    onError: (e: unknown) => toast.error(t(`errors.${(e as { code?: string }).code ?? 'network'}`)),
  });

  if (q.isLoading) return <Card><div className="skeleton h-24" /></Card>;
  const steps = q.data?.steps ?? [];
  const activeCaseId = q.data?.case?.id ?? createdRef.current;
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
                  onClick={() => openStep(s)}
                  title={done ? undefined : t('workflow.stepFiche')}
                  className={done ? 'text-[rgb(var(--c-primary))]' : cur ? 'text-[rgb(var(--c-amber))]' : ''}
                >
                  <motion.span
                    animate={cur ? { scale: [1, 1.12, 1] } : {}}
                    transition={{ repeat: Infinity, duration: 2.4 }}
                    className={`grid h-11 w-11 place-items-center rounded-2xl border-2 font-bold ${done ? 'border-[rgb(var(--c-ok))] bg-[rgb(var(--c-ok-soft))] text-[rgb(var(--c-ok))]' : cur ? 'border-[rgb(var(--c-amber))] bg-[rgb(var(--c-amber-soft))] text-[rgb(var(--c-amber))]' : 'border-[rgb(var(--c-line))] bg-[rgb(var(--c-surface))] text-[rgb(var(--c-muted))]'} `}
                  >
                    {done ? '✓' : i + 1}
                  </motion.span>
                </motion.button>
                <span className={`max-w-[110px] text-center text-[11.5px] font-semibold ${cur ? 'text-[rgb(var(--c-amber))]' : ''}`}>{stepLabelOf(s)}</span>
                {s.done_at ? <span dir="ltr" className="tabular-nums text-[10px] text-[rgb(var(--c-muted))]">{fmt(s.done_at, true)}</span> : null}
                {editable && activeCaseId && s.status !== 'todo' ? (
                  <button
                    className="text-[10px] font-semibold text-[rgb(var(--c-muted))] underline-offset-2 hover:text-[rgb(var(--c-coral))] hover:underline disabled:opacity-40"
                    title={t('workflow.cancelStep')}
                    disabled={cancelStep.isPending}
                    onClick={(e) => {
                      e.stopPropagation();
                      cancelStep.mutate(s);
                    }}
                  >
                    ↩ {t('workflow.cancelStep')}
                  </button>
                ) : null}
              </div>
              {i < steps.length - 1 ? <div className={`h-0.5 w-10 rounded ${done ? 'bg-[rgb(var(--c-ok))]' : 'bg-[rgb(var(--c-line))]'}`} /> : null}
            </React.Fragment>
          );
        })}
      </div>
      {q.data?.case ? (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-[rgb(var(--c-muted))]">
          <BizCode code={q.data.case.code} copy />
          <Badge tone={q.data.case.status === 'closed' ? 'neutral' : 'info'}>{q.data.case.status === 'closed' ? t('workflow.closed') : t('workflow.open')}</Badge>
          {q.data.case.status === 'closed' && editable ? (
            <Button size="sm" variant="ghost" onClick={() => void api.post(`/cases/${q.data.case?.id}/reopen`, {}).then(() => refresh())}>
              {t('workflow.reopen')}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12.5px] text-[rgb(var(--c-muted))]">{t('workflow.none')}</p>
          {editable ? <Button size="sm" variant="primary" onClick={() => void ensureCase(undefined)}>{t('workflow.start')}</Button> : null}
        </div>
      )}
      {/* Fiche d'étape — modale large rendue en portail : plus jamais tronquée par la carte. */}
      <Dialog
        xwide
        open={Boolean(fiche)}
        onClose={() => setFiche(null)}
        title={`${t('workflow.stepFiche')}${fiche ? ` — ${fiche.label}` : ''}`}
        footer={
          <>
            <Button onClick={() => setFiche(null)}>{t('cancel')}</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()} disabled={!activeCaseId}>
              {t('workflow.saveStep')}
            </Button>
          </>
        }
      >
        <FormProvider {...methods}>
          <div className="grid grid-cols-2 gap-3 py-1">
            <Field label={t('workflow.stepStatus')}>
              <Select {...methods.register('status')} options={[{ value: 'done', label: t('workflow.stDone') }, { value: 'in_progress', label: t('workflow.stProgress') }, { value: 'skipped', label: t('workflow.stSkip') }, { value: 'todo', label: t('workflow.stTodo') }]} />
            </Field>
            <Field label={t('workflow.at')}>
              <Input type="datetime-local" dir="ltr" {...methods.register('at')} />
            </Field>
            <Field label={t('workflow.location')}>
              <Select {...methods.register('locationId')} options={[{ value: '', label: '—' }, ...(locations.data?.rows ?? []).map((l) => ({ value: String(l.id), label: `${l.code} — ${l.name}` }))]} />
            </Field>
            <Field label={t('workflow.practitioners')}>
              <Multiselect
                name="practitionerIds"
                options={(practitioners.data?.rows ?? []).map((p) => ({
                  value: String(p.id),
                  label: (p.name as string) || `${String(p.last_name ?? '')} ${String(p.first_name ?? '')}`.trim() || String(p.code ?? p.id),
                }))}
              />
            </Field>
            <div className="col-span-2">
              <Field label={t('workflow.stepNote')}>
                <Textarea rows={3} {...methods.register('note')} />
              </Field>
            </div>
          </div>
        </FormProvider>
      </Dialog>
    </Card>
  );
}
