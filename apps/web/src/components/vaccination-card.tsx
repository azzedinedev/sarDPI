'use client';
/**
 * CARNET VACCINAL — briques d'affichage partagées (dossier patient ET Administration » Vaccination).
 * ----------------------------------------------------------------------------------------------
 * Le calendrier vaccinal est un réglage administrable ; le carnet d'un patient est le croisement de
 * ce calendrier et des doses saisies (`patient_vaccinations`). Le calcul (échéances, état par vaccin,
 * retards, pourcentage) est fait côté serveur par les fonctions pures de `@sardpi/shared` — ce
 * fichier ne fait QUE l'affichage : un seul rendu pour les deux écrans, aucune logique dupliquée.
 *
 * Les libellés viennent du namespace « patient » (clés `vax.*`) : le carnet est d'abord un objet
 * clinique du dossier patient, la page d'administration réutilise exactement les mêmes composants.
 */
import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, CheckCircle2, CircleDashed, MinusCircle, Syringe } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useFmtDate } from '@/lib/display';
import { Badge, Card, EmptyState } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { CoverageState } from '@sardpi/shared';

/** Entrée de calendrier telle que renvoyée par `GET /vaccinations/calendar` (libellé déjà traduit). */
export interface CalendarEntry {
  key: string;
  label: string;
  labelJson?: Record<string, string>;
  ageLabel: string;
  ageMonths: number;
  ageWeeks: number;
  doses: number;
  intervalDays: number;
  mandatory: boolean;
  active: boolean;
}

export interface VaccinationCalendar {
  enabled: boolean;
  entries: CalendarEntry[];
  isLoading: boolean;
  /** le réglage n'est pas accessible (permission) — les écrans masquent alors les libellés enrichis */
  error: boolean;
}

/** Calendrier vaccinal actif — mis en cache côté client (réglage, pas une donnée de santé). */
export function useVaccinationCalendar(): VaccinationCalendar {
  const q = useQuery({
    queryKey: ['vaccination-calendar'],
    queryFn: () => api.get<{ enabled: boolean; schedule: CalendarEntry[] }>('/vaccinations/calendar'),
    staleTime: 120_000,
    retry: false,
  });
  return useMemo(
    () => ({
      enabled: q.data?.enabled !== false,
      entries: Array.isArray(q.data?.schedule) ? q.data!.schedule : [],
      isLoading: q.isLoading,
      error: q.isError,
    }),
    [q.data, q.isLoading, q.isError],
  );
}

/** Options de sélection « vaccin » pour les formulaires (libellé + âge recommandé). */
export function vaccineOptions(entries: CalendarEntry[]): { value: string; label: string }[] {
  return entries
    .filter((e) => e.active !== false)
    .map((e) => ({ value: e.key, label: e.ageLabel ? `${e.label} · ${e.ageLabel}` : e.label }));
}

const STATE_TONE: Record<CoverageState, 'ok' | 'warn' | 'danger' | 'info' | 'neutral'> = {
  complete: 'ok',
  in_progress: 'info',
  due: 'warn',
  upcoming: 'neutral',
  not_started: 'neutral',
  refused: 'danger',
};

const STATE_ICON: Record<CoverageState, React.ComponentType<{ size?: number; className?: string }>> = {
  complete: CheckCircle2,
  in_progress: Syringe,
  due: CalendarClock,
  upcoming: CircleDashed,
  not_started: CircleDashed,
  refused: MinusCircle,
};

/** Pastille d'état d'un vaccin (complet, en cours, dû, à venir, non commencé, refusé) + retard. */
export function VaccineStateBadge({ state, overdue }: { state: CoverageState; overdue?: boolean }): React.ReactElement {
  const { t } = useT('patient');
  const Icon = STATE_ICON[state] ?? CircleDashed;
  return (
    <Badge tone={overdue ? 'danger' : STATE_TONE[state] ?? 'neutral'}>
      <Icon size={11} /> {overdue ? t('vax.state.overdue') : t(`vax.state.${state}`)}
    </Badge>
  );
}

/** Une ligne de couverture : vaccin, âge recommandé, progression des doses, prochaine échéance. */
export interface CoverageLine {
  key: string;
  label: string;
  ageLabel: string;
  mandatory: boolean;
  dosesTotal: number;
  done: number;
  state: CoverageState;
  overdue: boolean;
  nextDoseNo: number | null;
  nextDueAt: string | null;
}

export function CoverageList({
  coverage,
  className,
  actionFor,
}: {
  coverage: CoverageLine[];
  className?: string;
  /**
   * Gestes possibles sur la carte (Administrer / Reporter / Planifier la dose suivante) : une pastille
   * « En retard » sans action laisse l'écran au milieu du gué — c'est l'écran hôte qui fournit les
   * boutons, ce composant reste un simple afficheur.
   */
  actionFor?: (line: CoverageLine) => React.ReactNode;
}): React.ReactElement {
  const { t } = useT('patient');
  const fmt = useFmtDate();
  if (!coverage.length) return <EmptyState icon={Syringe} title={t('vax.coverage.empty')} hint={t('vax.coverage.emptyHint')} />;
  return (
    <ul className={cn('grid gap-2 sm:grid-cols-2 xl:grid-cols-3', className)}>
      {coverage.map((c) => {
        const pct = c.dosesTotal > 0 ? Math.round((c.done / c.dosesTotal) * 100) : 0;
        return (
          <li key={c.key}>
            <Card soft className="flex flex-col gap-1.5 p-3">
              <div className="flex items-start gap-2">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[rgb(var(--c-primary)/0.12)] text-[rgb(var(--c-primary))]">
                  <Syringe size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold" title={c.label}>
                    {c.label}
                  </span>
                  <span className="block truncate text-[11px] text-[rgb(var(--c-muted))]">
                    {c.ageLabel || t('vax.ageUnspecified')}
                    {c.mandatory ? ` · ${t('vax.mandatory')}` : ''}
                  </span>
                </span>
                <VaccineStateBadge state={c.state} overdue={c.overdue} />
              </div>
              <div className="flex items-center gap-2">
                <div aria-hidden className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[rgb(var(--c-surface-2))]">
                  <div
                    className={cn('h-full rounded-full transition-[width]', c.overdue ? 'bg-[rgb(var(--c-coral))]' : c.state === 'complete' ? 'bg-[rgb(var(--c-ok))]' : 'bg-[rgb(var(--c-primary))]')}
                    style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
                  />
                </div>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-[rgb(var(--c-muted))]">
                  {c.done}/{c.dosesTotal}
                </span>
              </div>
              {c.nextDueAt && c.state !== 'complete' ? (
                <p className={cn('flex items-center gap-1.5 text-[11px]', c.overdue ? 'font-bold text-[rgb(var(--c-coral))]' : 'text-[rgb(var(--c-muted))]')}>
                  {c.overdue ? <AlertTriangle size={11} /> : <CalendarClock size={11} />}
                  {t('vax.nextDue', { dose: String(c.nextDoseNo ?? 1), date: fmt(c.nextDueAt, true) })}
                </p>
              ) : null}
              {actionFor ? <div className="mt-0.5 flex flex-wrap items-center gap-1">{actionFor(c)}</div> : null}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

/** Bandeau de synthèse du carnet (pourcentage de doses faites, vaccins complets, retards). */
export function CoverageSummaryBar({ summary }: { summary: { vaccines: number; complete: number; overdue: number; dosesDone: number; dosesExpected: number; percent: number } }): React.ReactElement {
  const { t } = useT('patient');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone={summary.percent >= 100 ? 'ok' : summary.overdue > 0 ? 'warn' : 'info'}>
        <Syringe size={11} /> {t('vax.summary.doses', { done: summary.dosesDone, expected: summary.dosesExpected })}
      </Badge>
      <Badge tone="neutral">{t('vax.summary.complete', { count: summary.complete, total: summary.vaccines })}</Badge>
      {summary.overdue > 0 ? (
        <Badge tone="danger">
          <AlertTriangle size={11} /> {t('vax.summary.overdue', { count: summary.overdue })}
        </Badge>
      ) : null}
      <span className="ms-auto flex items-center gap-2 text-[11.5px] text-[rgb(var(--c-muted))]">
        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-[rgb(var(--c-surface-2))]">
          <span className={cn('block h-full rounded-full', summary.percent >= 100 ? 'bg-[rgb(var(--c-ok))]' : 'bg-[rgb(var(--c-primary))]')} style={{ width: `${summary.percent}%` }} />
        </span>
        <span className="font-mono tabular-nums">{summary.percent}%</span>
      </span>
    </div>
  );
}
