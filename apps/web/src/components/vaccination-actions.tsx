'use client';
/**
 * ACTIONS RAPIDES DU CARNET VACCINAL — « quelle est la suite ? »
 * --------------------------------------------------------------
 * Afficher une pastille « En retard » sans geste possible laisse l'écran au milieu du gué : cet
 * ensemble de composants donne la SUITE clinique de chaque dose, au plus près de la ligne :
 *
 *   • ADMINISTRER  une petite fiche (date, lot, site, note) → `POST /vaccinations/:id/status`
 *                  (`action: 'done'`). Le serveur date du jour par défaut, inscrit l'événement dans
 *                  l'historique clinique et PLANIFIE LA DOSE SUIVANTE de la série (échéance = date
 *                  d'administration + intervalle du calendrier). La réponse renvoie cette dose :
 *                  l'écran l'annonce (« Dose 3 planifiée — 12/03/2026 ») au lieu de la laisser
 *                  apparaître sans explication.
 *   • REPORTER     nouvelle échéance (raccourcis +7 / +15 / +30 jours ou date libre) + motif.
 *   • REFUS / RDV MANQUÉ  trace le motif dans la dose (historique clinique).
 *   • MODIFIER / SUPPRIMER  le formulaire complet du module CRUD (crayon et menu « … » désormais
 *                  visibles en permanence sur la ligne, plus seulement au survol).
 *
 * Les mêmes composants servent au dossier patient (onglet Vaccination), au panneau de suivi et à
 * Administration » Vaccination : une seule définition des gestes, aucun doublon de logique.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CalendarPlus, Check, Pencil, Syringe, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useFmtDate } from '@/lib/display';
import { Badge, Button, Field, Input, Textarea } from '@/components/ui';
import { Dialog } from '@/components/dialogs';
import { useToast } from '@/components/toast';
import { useAuth } from '@/stores/auth';
import { addDays, type VaccinationStatus } from '@sardpi/shared';

/** Ligne de dose telle que renvoyée par le CRUD `vaccinations` (champs utiles aux actions). */
export interface DoseRow {
  id: number;
  code?: string | null;
  patient_id?: number | null;
  patient_name?: string | null;
  vaccine_key?: string;
  vaccine_label?: string | null;
  dose_no?: number | string;
  status?: string;
  administered_at?: string | null;
  due_at?: string | null;
  batch?: string | null;
  site?: string | null;
  notes?: string | null;
}

/** Réponse de `POST /vaccinations/:id/status` — `next` = dose suivante planifiée par le serveur. */
interface StatusResult {
  ok: boolean;
  row: DoseRow;
  next: { id: number; code: string; doseNo: number; dueAt: string | null } | null;
}

/** Quel geste rapide proposer selon le statut courant de la dose. */
export function doseStatusOf(row: DoseRow | null | undefined): VaccinationStatus {
  const s = String(row?.status ?? 'planned');
  return s === 'done' || s === 'refused' || s === 'missed' ? s : 'planned';
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Mutation partagée des transitions rapides + rafraîchissement des caches concernés (carnet du
 * patient, liste des doses, calendrier transversal, historique clinique, statistiques admin).
 */
export function useDoseStatus(patientId?: number | null): {
  mutate: (id: number, payload: Record<string, unknown>, opts?: { success?: (res: StatusResult) => void }) => void;
  pending: boolean;
} {
  const { t } = useT('patient');
  const { t: te } = useT('errors');
  const toast = useToast();
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Record<string, unknown> }) =>
      api.post<StatusResult>(`/vaccinations/${id}/status`, payload),
    onSuccess: (res, vars: { id: number; payload: Record<string, unknown>; opts?: { success?: (res: StatusResult) => void } }) => {
      void qc.invalidateQueries({ queryKey: ['list', 'vaccinations'] });
      void qc.invalidateQueries({ queryKey: ['vaccination-calendar'] });
      void qc.invalidateQueries({ queryKey: ['vaccination-stats'] });
      const pid = patientId ?? Number(res.row?.patient_id ?? 0);
      if (pid) {
        void qc.invalidateQueries({ queryKey: ['vaccination-carnet', pid] });
        void qc.invalidateQueries({ queryKey: ['history', pid] });
      }
      // la dose suivante est ANNONCÉE (et non simplement apparue dans la liste) : la planification
      // automatique doit rester lisible pour l'agent qui vient d'administrer la dose précédente.
      if (res.next) toast.success(t('vax.nextPlanned', { dose: String(res.next.doseNo), date: res.next.dueAt ?? '—' }));
      vars.opts?.success?.(res);
    },
    onError: (e: unknown) => {
      // le serveur renvoie un CODE traduit (409 dose déjà administrée, 422 date future/invalide…)
      const err = e as { code?: string; details?: Record<string, string> };
      const code = String(err?.code ?? '');
      const firstField = err?.details ? Object.values(err.details)[0] : undefined;
      toast.error(firstField ? `${te(code)} — ${firstField}` : code.startsWith('errors.') ? te(code) : t('vax.quick.error'));
    },
  });
  return {
    mutate: (id, payload, opts) => mut.mutate({ id, payload, opts } as { id: number; payload: Record<string, unknown> }),
    pending: mut.isPending,
  };
}

/** Petite fiche « Administrer la dose » : date (défaut = aujourd'hui), lot, site, note. */
export function MarkDoneDialog({
  row,
  open,
  onClose,
  patientId,
  onDone,
}: {
  row: DoseRow | null;
  open: boolean;
  onClose: () => void;
  patientId?: number | null;
  onDone?: () => void;
}): React.ReactElement | null {
  const { t } = useT('patient');
  const { t: tc } = useT('common');
  const status = useDoseStatus(patientId ?? row?.patient_id ?? null);
  const [at, setAt] = useState(today());
  const [batch, setBatch] = useState('');
  const [site, setSite] = useState('');
  const [notes, setNotes] = useState('');
  const [planNext, setPlanNext] = useState(true);

  // réinitialisation à chaque ouverture (une fiche ne doit pas hériter de la dose précédente)
  useEffect(() => {
    if (!open) return;
    setAt(row?.administered_at ? String(row.administered_at).slice(0, 10) : today());
    setBatch(row?.batch ? String(row.batch) : '');
    setSite(row?.site ? String(row.site) : '');
    setNotes('');
    setPlanNext(true);
  }, [open, row]);

  if (!open || !row) return null;
  const title = `${row.vaccine_label ?? row.vaccine_key ?? ''} — ${t('vax.dose')} ${String(row.dose_no ?? 1)}`;
  return (
    <Dialog
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Syringe size={16} className="text-[rgb(var(--c-primary))]" /> {t('vax.quick.done')}
          <span className="text-[12.5px] font-semibold text-[rgb(var(--c-muted))]">{title}</span>
        </span>
      }
      footer={
        <>
          <Button onClick={onClose}>{tc('cancel')}</Button>
          <Button
            variant="ok"
            loading={status.pending}
            onClick={() =>
              status.mutate(
                row.id,
                {
                  action: 'done',
                  administeredAt: at || null,
                  batch: batch || null,
                  site: site || null,
                  reason: notes || null,
                  planNext,
                },
                {
                  success: () => {
                    onClose();
                    onDone?.();
                  },
                },
              )
            }
          >
            <Check size={14} /> {t('vax.quick.confirmDone')}
          </Button>
        </>
      }
    >
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Field label={t('vax.administeredAt')} hint={t('vax.administeredAt.hint')}>
          <Input type="date" value={at} max={today()} onChange={(e) => setAt(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t('vax.batch')}>
          <Input value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="LOT-2026-0148" dir="ltr" />
        </Field>
        <Field label={t('vax.site')}>
          <Input value={site} onChange={(e) => setSite(e.target.value)} placeholder="Deltoïde gauche" />
        </Field>
        <Field label={tc('notes')} className="sm:col-span-2">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('vax.quick.reasonPlaceholder')} />
        </Field>
      </div>
      <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-xl bg-[rgb(var(--c-surface-2))] px-3 py-2 text-[12.5px]">
        <input type="checkbox" className="mt-0.5" checked={planNext} onChange={(e) => setPlanNext(e.target.checked)} />
        <span>
          <span className="block font-bold">{t('vax.planNext')}</span>
          <span className="block text-[rgb(var(--c-muted))]">{t('vax.planNext.hint')}</span>
        </span>
      </label>
    </Dialog>
  );
}

/** Report d'une dose : raccourcis (+7 / +15 / +30 jours) ou date libre, plus un motif tracé. */
export function RescheduleDialog({
  row,
  open,
  onClose,
  patientId,
  onDone,
}: {
  row: DoseRow | null;
  open: boolean;
  onClose: () => void;
  patientId?: number | null;
  onDone?: () => void;
}): React.ReactElement | null {
  const { t } = useT('patient');
  const { t: tc } = useT('common');
  const fmt = useFmtDate();
  const status = useDoseStatus(patientId ?? row?.patient_id ?? null);
  const [due, setDue] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) return;
    setDue(row?.due_at ? String(row.due_at).slice(0, 10) : (addDays(today(), 30) ?? today()));
    setReason('');
  }, [open, row]);

  const presets = useMemo(() => [7, 15, 30, 90], []);
  if (!open || !row) return null;
  const title = `${row.vaccine_label ?? row.vaccine_key ?? ''} — ${t('vax.dose')} ${String(row.dose_no ?? 1)}`;
  return (
    <Dialog
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <CalendarClock size={16} className="text-[rgb(var(--c-primary))]" /> {t('vax.quick.reschedule')}
          <span className="text-[12.5px] font-semibold text-[rgb(var(--c-muted))]">{title}</span>
        </span>
      }
      footer={
        <>
          <Button onClick={onClose}>{tc('cancel')}</Button>
          <Button
            variant="primary"
            disabled={!due}
            loading={status.pending}
            onClick={() =>
              status.mutate(row.id, { action: 'planned', dueAt: due, reason: reason || null }, { success: () => { onClose(); onDone?.(); } })
            }
          >
            <CalendarClock size={14} /> {t('vax.quick.rescheduleConfirm')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        {row.due_at ? (
          <p className="text-[12.5px] text-[rgb(var(--c-muted))]">
            {t('vax.quick.currentDue', { date: fmt(String(row.due_at).slice(0, 10), true) })}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-1.5">
          {presets.map((d) => (
            <Button key={d} size="sm" variant="ghost" onClick={() => setDue(addDays(today(), d) ?? today())}>
              {t('vax.reschedule.plus', { days: String(d) })}
            </Button>
          ))}
        </div>
        <Field label={t('vax.quick.newDue')} required>
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t('vax.quick.reason')} hint={t('vax.quick.reasonHint')}>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

/**
 * Boutons d'action d'une dose — rendus EN CLAIR sur la ligne (module CRUD `rowAction`) et dans le
 * panneau de suivi. Rien n'est affiché sans le droit `vaccination:update` : pas de bouton mort.
 */
export function DoseQuickActions({
  row,
  patientId,
  onEdit,
  onDone,
  compact,
  showEdit = true,
}: {
  row: DoseRow;
  patientId?: number | null;
  /** ouvre le formulaire complet du module CRUD (crayon) — fourni par l'écran hôte */
  onEdit?: (row: DoseRow) => void;
  onDone?: () => void;
  /** version resserrée (carte de couverture) : icônes seules */
  compact?: boolean;
  /** faux dans la ligne du CRUD : le crayon d'édition y est déjà rendu par le module */
  showEdit?: boolean;
}): React.ReactElement | null {
  const { t } = useT('patient');
  const has = useAuth((s) => s.has);
  const [doneOpen, setDoneOpen] = useState(false);
  const [reschedOpen, setReschedOpen] = useState(false);
  const status = useDoseStatus(patientId ?? row.patient_id ?? null);
  if (!has('vaccination', 'update')) return null;
  const st = doseStatusOf(row);
  const pid = patientId ?? row.patient_id ?? null;

  return (
    <>
      {st !== 'done' ? (
        <span className="flex flex-wrap items-center gap-1">
          <Button
            size="sm"
            variant="ok"
            title={t('vax.quick.done')}
            onClick={() => setDoneOpen(true)}
            className={compact ? 'btn-icon !min-h-7 !min-w-7' : undefined}
          >
            <Check size={13} /> {compact ? <span className="sr-only">{t('vax.quick.done')}</span> : t('vax.quick.done')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            title={t('vax.quick.reschedule')}
            onClick={() => setReschedOpen(true)}
            className={compact ? 'btn-icon !min-h-7 !min-w-7' : undefined}
          >
            <CalendarClock size={13} /> {compact ? <span className="sr-only">{t('vax.quick.reschedule')}</span> : t('vax.quick.reschedule')}
          </Button>
          {st === 'planned' ? (
            <Button
              size="sm"
              variant="ghost"
              title={t('vax.quick.missed')}
              loading={status.pending}
              onClick={() => status.mutate(row.id, { action: 'missed' }, { success: onDone })}
              className={compact ? 'btn-icon !min-h-7 !min-w-7' : undefined}
            >
              <X size={13} /> {compact ? null : t('vax.quick.missed')}
            </Button>
          ) : null}
          {onEdit && showEdit ? (
            <Button size="sm" variant="ghost" title={t('vax.quick.edit')} onClick={() => onEdit(row)} className={compact ? 'btn-icon !min-h-7 !min-w-7' : undefined}>
              <Pencil size={13} /> {compact ? <span className="sr-only">{t('vax.quick.edit')}</span> : t('vax.quick.edit')}
            </Button>
          ) : null}
        </span>
      ) : (
        <span className="flex flex-wrap items-center gap-1">
          <Badge tone="ok">
            <Check size={11} /> {t('vax.quick.alreadyDone')}
          </Badge>
          {onEdit && showEdit ? (
            <Button size="sm" variant="ghost" title={t('vax.quick.edit')} onClick={() => onEdit(row)} className={compact ? 'btn-icon !min-h-7 !min-w-7' : undefined}>
              <Pencil size={13} /> {compact ? <span className="sr-only">{t('vax.quick.edit')}</span> : t('vax.quick.edit')}
            </Button>
          ) : null}
        </span>
      )}
      <MarkDoneDialog row={row} open={doneOpen} onClose={() => setDoneOpen(false)} patientId={pid} onDone={onDone} />
      <RescheduleDialog row={row} open={reschedOpen} onClose={() => setReschedOpen(false)} patientId={pid} onDone={onDone} />
    </>
  );
}

/**
 * Raccourci « planifier la prochaine dose » depuis la carte de couverture d'un vaccin : crée la dose
 * manquante (statut « planifiée », échéance calculée) via `POST /patients/:id/vaccination/generate`.
 * Utilisé quand AUCUNE ligne n'existe encore pour ce vaccin — le carnet se complète sans formulaire.
 */
export function PlanNextDoseButton({
  pid,
  vaccineKey,
  label,
  onDone,
}: {
  pid: number;
  vaccineKey?: string;
  label?: string;
  onDone?: () => void;
}): React.ReactElement | null {
  const { t } = useT('patient');
  const { t: te } = useT('errors');
  const toast = useToast();
  const qc = useQueryClient();
  const has = useAuth((s) => s.has);
  const mut = useMutation({
    mutationFn: () => api.post<{ created: number; skipped: number }>(`/patients/${pid}/vaccination/generate`, {}),
    onSuccess: (res) => {
      if (res.created > 0) toast.success(t('vax.generate.done', { count: res.created }));
      else toast.info(t('vax.planNext.none'));
      void qc.invalidateQueries({ queryKey: ['vaccination-carnet', pid] });
      void qc.invalidateQueries({ queryKey: ['list', 'vaccinations'] });
      void qc.invalidateQueries({ queryKey: ['history', pid] });
      onDone?.();
    },
    onError: (e: unknown) => {
      const code = String((e as { code?: string })?.code ?? '');
      toast.error(code.startsWith('errors.') ? te(code) : t('vax.generate.error'));
    },
  });
  if (!has('vaccination', 'create')) return null;
  return (
    <Button size="sm" variant="ghost" loading={mut.isPending} onClick={() => mut.mutate()} title={label ? t('vax.planNext.hintFor', { vaccine: label }) : t('vax.planNext.hint')}>
      <CalendarPlus size={13} /> {t('vax.planNext')}
    </Button>
  );
}

/** Ligne « à traiter » du panneau de suivi (retard, refus, rendez-vous manqué) + ses gestes. */
export interface FollowUpRow {
  vaccineKey: string;
  label?: string;
  labelJson?: Record<string, string>;
  mandatory: boolean;
  ageLabel?: string;
  doseNo: number | null;
  status: string;
  dueAt: string | null;
  daysLate: number;
  overdue: boolean;
  refused: boolean;
  missed: boolean;
  doseId: number | null;
  doseCode: string | null;
}

export function FollowUpList({
  pid,
  rows,
  onEdit,
  onDone,
  className,
}: {
  pid: number;
  rows: FollowUpRow[];
  onEdit?: (row: DoseRow) => void;
  onDone?: () => void;
  className?: string;
}): React.ReactElement | null {
  const { t } = useT('patient');
  const fmt = useFmtDate();
  const has = useAuth((s) => s.has);
  const canPlan = has('vaccination', 'create');
  const canAct = has('vaccination', 'update');
  if (!rows.length) return null;

  return (
    <section className={className}>
      <ul className="flex flex-col gap-1.5">
        {rows.map((r, i) => {
          const key = `${r.vaccineKey}-${r.doseNo ?? 'x'}-${i}`;
          const dose: DoseRow | null = r.doseId
            ? {
                id: r.doseId,
                code: r.doseCode,
                patient_id: pid,
                vaccine_key: r.vaccineKey,
                vaccine_label: r.label ?? r.vaccineKey,
                dose_no: r.doseNo ?? 1,
                status: r.status,
                due_at: r.dueAt,
              }
            : null;
          return (
            <li key={key}>
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[rgb(var(--c-border))] bg-[rgb(var(--c-surface))] px-3 py-2">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[rgb(var(--c-coral)/0.12)] text-[rgb(var(--c-coral))]">
                  <Syringe size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold">
                    {r.label ?? r.vaccineKey}
                    {r.doseNo ? <span className="font-semibold text-[rgb(var(--c-muted))]"> · {t('vax.dose')} {r.doseNo}</span> : null}
                    {r.mandatory ? <span className="ms-1.5 text-[11px] font-bold text-[rgb(var(--c-amber))]">{t('vax.mandatory')}</span> : null}
                  </span>
                  <span className="block truncate text-[11.5px] text-[rgb(var(--c-muted))]">
                    {r.dueAt ? `${t('vax.followUp.due', { date: fmt(r.dueAt, true) })} · ` : ''}
                    {r.overdue
                      ? t('vax.followUp.late', { days: String(r.daysLate) })
                      : r.refused
                        ? t('vax.followUp.refused')
                        : t('vax.followUp.missed')}
                  </span>
                </span>
                {dose && canAct ? <DoseQuickActions row={dose} patientId={pid} onEdit={onEdit} onDone={onDone} compact /> : null}
                {!dose && canPlan ? <PlanNextDoseButton pid={pid} vaccineKey={r.vaccineKey} label={r.label} onDone={onDone} /> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Impression du carnet vaccinal (droit `vaccination:print`) — même pattern que la fiche réduite du
 * dossier patient : fenêtre dédiée, styles d'impression sobres, aucun thème applicatif.
 */
export function printVaccinationCard(args: {
  patient: { code: string; fullName: string; birthDate: string | null };
  coverage: { label: string; ageLabel: string; mandatory: boolean; dosesTotal: number; done: number; state: string; overdue: boolean; nextDueAt: string | null }[];
  doses: { code: string; vaccine_label?: string; vaccine_key?: string; dose_no: number; status: string; administered_at: string | null; due_at: string | null; batch?: string | null; site?: string | null }[];
  labels: Record<string, string>;
  lang: string;
  dir: 'rtl' | 'ltr';
  fmt?: (v: unknown, dateOnly?: boolean) => string;
}): void {
  const esc = (x: unknown): string =>
    String(x ?? '').replace(/[&<>\"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
  const L = args.labels;
  const d = (v: unknown): string => (args.fmt ? args.fmt(v, true) : String(v ?? '').slice(0, 10));
  const coverageRows = args.coverage
    .map(
      (c) =>
        `<tr><td>${esc(c.label)}</td><td>${esc(c.ageLabel || '—')}</td><td class="c">${esc(c.done)}/${esc(c.dosesTotal)}</td><td class="c">${esc(L[`state.${c.state}`] ?? c.state)}${c.overdue ? ` ⚠ ${esc(L.overdue ?? '')}` : ''}</td><td class="code">${c.nextDueAt && c.state !== 'complete' ? esc(d(c.nextDueAt)) : '—'}</td></tr>`,
    )
    .join('');
  const doseRows = args.doses
    .map(
      (x) =>
        `<tr><td class="code">${esc(x.code)}</td><td>${esc(x.vaccine_label ?? x.vaccine_key ?? '')}</td><td class="c">${esc(x.dose_no)}</td><td class="c">${esc(L[`status.${x.status}`] ?? x.status)}</td><td class="code">${x.administered_at ? esc(d(x.administered_at)) : '—'}</td><td class="code">${x.due_at ? esc(d(x.due_at)) : '—'}</td><td>${esc(x.batch ?? '—')}</td><td>${esc(x.site ?? '—')}</td></tr>`,
    )
    .join('');
  const html = `<!doctype html><html dir="${args.dir}" lang="${args.lang}"><head><meta charset="utf-8"><title>${esc(L.title ?? 'Vaccination')} — ${esc(args.patient.fullName)}</title><style>
  body{font-family:Arial,Helvetica,sans-serif;margin:22px;color:#111}
  h2{font-size:17px;margin:0 0 4px}h3{font-size:13.5px;margin:18px 0 6px}
  table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4px 7px;font-size:11.5px;text-align:start}
  th{background:#f2f2f2}.c{text-align:center}.code{font-family:monospace;direction:ltr}
  .head{font-size:12px;margin-bottom:10px}.foot{margin-top:16px;font-size:10.5px;color:#555}
  </style></head><body>
  <h2>${esc(L.title ?? 'Carnet vaccinal')} — ${esc(args.patient.fullName)}</h2>
  <div class="head"><span class="code">${esc(args.patient.code)}</span> · ${esc(L.birth ?? '')} : <span class="code">${args.patient.birthDate ? esc(d(args.patient.birthDate)) : '—'}</span> · ${esc(L.printedAt ?? '')} : <span class="code">${esc(new Date().toISOString().slice(0, 10))}</span></div>
  <h3>${esc(L.coverage ?? '')}</h3>
  <table><thead><tr><th>${esc(L.vaccine ?? '')}</th><th>${esc(L.age ?? '')}</th><th class="c">${esc(L.done ?? '')}</th><th class="c">${esc(L.state ?? '')}</th><th>${esc(L.nextDue ?? '')}</th></tr></thead><tbody>${coverageRows || `<tr><td colspan="5">${esc(L.empty ?? '—')}</td></tr>`}</tbody></table>
  <h3>${esc(L.doses ?? '')}</h3>
  <table><thead><tr><th>${esc(L.code ?? '')}</th><th>${esc(L.vaccine ?? '')}</th><th class="c">${esc(L.doseNo ?? '')}</th><th class="c">${esc(L.status ?? '')}</th><th>${esc(L.administeredAt ?? '')}</th><th>${esc(L.dueAt ?? '')}</th><th>${esc(L.batch ?? '')}</th><th>${esc(L.site ?? '')}</th></tr></thead><tbody>${doseRows || `<tr><td colspan="8">${esc(L.empty ?? '—')}</td></tr>`}</tbody></table>
  <div class="foot">${esc(L.footer ?? '')}</div>
  <script>window.onload=()=>window.print()</script></body></html>`;
  const w = window.open('', '_blank', 'width=900,height=700');
  if (w) {
    w.document.write(html);
    w.document.close();
  }
}
