'use client';
/**
 * ONGLET « VACCINATION » DU DOSSIER PATIENT — le carnet vaccinal rattaché au patient.
 * ----------------------------------------------------------------------------------
 * Quatre lectures complémentaires, du plus synthétique au plus actionnable :
 *   1. la synthèse (pourcentage de doses faites, vaccins complets, retards) ;
 *   2. À TRAITER — la réponse à « quelle est la suite ? » : chaque retard / refus / rendez-vous
 *      manqué avec ses gestes (Administrer, Reporter, Planifier la dose suivante, Modifier) ;
 *   3. la couverture vaccin par vaccin (progression, prochaine échéance calculée depuis la date de
 *      naissance, état : complet / en cours / dû / à venir / refusé) ;
 *   4. les doses saisies (CRUD complet : date, lot, site, praticien, lieu, notes, archivage) avec
 *      actions rapides visibles sur chaque ligne — plus besoin de deviner un survol.
 *
 * Le calendrier vaccinal et les calculs viennent du serveur (`GET /patients/:id/vaccination`,
 * fonctions pures de `@sardpi/shared`) : l'onglet n'invente aucune échéance et reste cohérent avec
 * Administration » Vaccination. « Générer le calendrier » matérialise les doses manquantes en
 * « planifié » — pratique à l'ouverture d'un carnet pédiatrique, et sans effet sur les doses déjà
 * saisies (idempotent).
 */
import React, { useMemo, useRef } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, ListChecks, Printer, RefreshCw, Syringe } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useFmtDate } from '@/lib/display';
import { Button, Card, EmptyState } from '@/components/ui';
import { useAuth } from '@/stores/auth';
import { CoverageList, CoverageSummaryBar, type CoverageLine } from '@/components/vaccination-card';
import { GeneratePlanButton, VaccinationDosesModule } from '@/components/vaccination-crud';
import {
  DoseQuickActions,
  FollowUpList,
  PlanNextDoseButton,
  printVaccinationCard,
  type DoseRow,
  type FollowUpRow,
} from '@/components/vaccination-actions';
import type { RowData } from '@/components/crud/types';

interface Carnet {
  patient: { id: number; code: string; fullName: string; birthDate: string | null };
  enabled: boolean;
  summary: { vaccines: number; mandatory: number; complete: number; overdue: number; dosesDone: number; dosesExpected: number; percent: number };
  coverage: CoverageLine[];
  followUps?: FollowUpRow[];
  doses: (DoseRow & { site?: string | null; batch?: string | null })[];
}

export function VaccinationTab({ pid }: { pid: number }): React.ReactElement {
  const { t, lang, dir } = useT('patient');
  const fmt = useFmtDate();
  const has = useAuth((s) => s.has);
  const qc = useQueryClient();
  const canView = has('vaccination', 'view');
  /** ouvre le formulaire d'édition du module de doses depuis le panneau « À traiter » */
  const editRow = useRef<((row: RowData) => void) | null>(null);

  const carnet = useQuery({
    queryKey: ['vaccination-carnet', pid],
    queryFn: () => api.get<Carnet>(`/patients/${pid}/vaccination`),
    enabled: canView,
  });

  if (!canView) {
    return <EmptyState icon={Syringe} title={t('vax.forbidden')} hint={t('vax.forbiddenHint')} />;
  }

  const refresh = (): void => {
    void qc.invalidateQueries({ queryKey: ['vaccination-carnet', pid] });
    void qc.invalidateQueries({ queryKey: ['list', 'vaccinations'] });
    void qc.invalidateQueries({ queryKey: ['vaccination-calendar'] });
    void qc.invalidateQueries({ queryKey: ['vaccination-stats'] });
    void qc.invalidateQueries({ queryKey: ['history', pid] });
  };

  /** doses actives indexées par (vaccin, n° de dose) — les actions rapides réutilisent la ligne */
  const dosesByKey = useMemo(() => {
    const m = new Map<string, DoseRow>();
    for (const d of carnet.data?.doses ?? []) m.set(`${d.vaccine_key}#${Number(d.dose_no ?? 1)}`, d);
    return m;
  }, [carnet.data]);

  const followUps = carnet.data?.followUps ?? [];

  /** actions de la carte de couverture : geste sur la dose manquante, ou planification si absente */
  const actionFor = (line: CoverageLine): React.ReactNode => {
    if (!carnet.data || line.state === 'complete') return null;
    const row = line.nextDoseNo ? dosesByKey.get(`${line.key}#${line.nextDoseNo}`) : undefined;
    if (row) return <DoseQuickActions row={row} patientId={pid} onEdit={(r) => editRow.current?.(r as unknown as RowData)} onDone={refresh} compact />;
    return <PlanNextDoseButton pid={pid} vaccineKey={line.key} label={line.label} onDone={refresh} />;
  };

  const print = (): void =>
    printVaccinationCard({
      patient: carnet.data!.patient,
      coverage: carnet.data!.coverage,
      doses: (carnet.data!.doses ?? []).map((d) => ({
        code: String(d.code ?? ''),
        vaccine_label: String(d.vaccine_label ?? d.vaccine_key ?? ''),
        vaccine_key: d.vaccine_key,
        dose_no: Number(d.dose_no ?? 1),
        status: String(d.status ?? 'planned'),
        administered_at: d.administered_at ?? null,
        due_at: d.due_at ?? null,
        batch: d.batch ?? null,
        site: d.site ?? null,
      })),
      lang,
      dir,
      fmt,
      labels: {
        title: t('vax.print.title'),
        birth: t('vax.print.birth'),
        printedAt: t('vax.print.printedAt'),
        coverage: t('vax.coverage'),
        doses: t('vax.doses'),
        vaccine: t('vax.vaccine'),
        age: t('vax.age'),
        done: t('vax.print.doneCol'),
        state: t('vax.print.state'),
        nextDue: t('vax.print.nextDue'),
        doseNo: t('vax.dose'),
        status: t('vax.status'),
        administeredAt: t('vax.administeredAt'),
        dueAt: t('vax.dueAt'),
        batch: t('vax.batch'),
        site: t('vax.site'),
        code: t('vax.print.code'),
        overdue: t('vax.state.overdue'),
        empty: t('vax.coverage.empty'),
        footer: t('vax.print.footer'),
        'state.complete': t('vax.state.complete'),
        'state.in_progress': t('vax.state.in_progress'),
        'state.due': t('vax.state.due'),
        'state.upcoming': t('vax.state.upcoming'),
        'state.not_started': t('vax.state.not_started'),
        'state.refused': t('vax.state.refused'),
        'status.done': t('vax.status.done'),
        'status.planned': t('vax.status.planned'),
        'status.refused': t('vax.status.refused'),
        'status.missed': t('vax.status.missed'),
      },
    });

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="flex items-center gap-2 text-[14px] font-bold">
            <Syringe size={15} className="text-[rgb(var(--c-primary))]" /> {t('vax.coverage')}
          </h3>
          <span className="text-[11.5px] text-[rgb(var(--c-muted))]">
            {carnet.data?.patient.birthDate ? t('vax.birthDate', { date: fmt(carnet.data.patient.birthDate, true) }) : t('vax.noBirthDate')}
          </span>
          <div className="ms-auto flex items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={refresh} title={t('vax.refresh')} aria-label={t('vax.refresh')}>
              <RefreshCw size={13} />
            </Button>
            {has('vaccination', 'print') ? (
              <Button size="sm" variant="ghost" onClick={print} disabled={!carnet.data} title={t('vax.print')}>
                <Printer size={13} /> {t('vax.print')}
              </Button>
            ) : null}
            <GeneratePlanButton pid={pid} onDone={refresh} />
            <Link href="/admin/vaccination" className="btn btn-ghost btn-sm">
              {t('vax.manageCalendar')}
            </Link>
          </div>
        </div>

        {carnet.isLoading ? <div className="skeleton h-24 w-full" /> : null}
        {carnet.data ? <CoverageSummaryBar summary={carnet.data.summary} /> : null}
        {carnet.data && !carnet.data.enabled ? (
          <p className="flex items-center gap-2 rounded-xl bg-[rgb(var(--c-amber-soft))] px-3 py-2 text-[12px] font-semibold text-[rgb(var(--c-amber))]">
            <AlertTriangle size={13} /> {t('vax.disabledNotice')}
          </p>
        ) : null}
      </Card>

      {/* « À traiter » — la suite clinique : retards, refus, rendez-vous manqués, avec leurs gestes */}
      {carnet.data && followUps.length ? (
        <Card soft className="flex flex-col gap-2 p-4">
          <h3 className="flex items-center gap-2 text-[14px] font-bold">
            <ListChecks size={15} className="text-[rgb(var(--c-coral))]" /> {t('vax.followUp.title')}
            <span className="rounded-full bg-[rgb(var(--c-coral)/0.14)] px-2 py-0.5 text-[11.5px] font-bold text-[rgb(var(--c-coral))]">{followUps.length}</span>
          </h3>
          <p className="flex items-center gap-1.5 text-[11.5px] text-[rgb(var(--c-muted))]">
            <CalendarClock size={12} /> {t('vax.followUp.hint')}
          </p>
          <FollowUpList pid={pid} rows={followUps} onEdit={(r) => editRow.current?.(r as unknown as RowData)} onDone={refresh} />
        </Card>
      ) : null}

      {carnet.data ? <CoverageList coverage={carnet.data.coverage} actionFor={actionFor} /> : null}

      <VaccinationDosesModule
        pid={pid}
        title={t('vax.doses')}
        subtitle={t('vax.dosesHint')}
        onSaved={refresh}
        editRowRef={editRow}
      />
    </div>
  );
}
