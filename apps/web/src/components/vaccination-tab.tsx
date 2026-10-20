'use client';
/**
 * ONGLET « VACCINATION » DU DOSSIER PATIENT — le carnet vaccinal rattaché au patient.
 * ----------------------------------------------------------------------------------
 * Trois lectures complémentaires, du plus synthétique au plus détaillé :
 *   1. la synthèse (pourcentage de doses faites, vaccins complets, retards) ;
 *   2. la couverture vaccin par vaccin (progression, prochaine échéance calculée depuis la date de
 *      naissance, état : complet / en cours / dû / à venir / refusé) ;
 *   3. les doses saisies (CRUD complet : date, lot, site, praticien, lieu, notes, archivage).
 *
 * Le calendrier vaccinal et les calculs viennent du serveur (`GET /patients/:id/vaccination`,
 * fonctions pures de `@sardpi/shared`) : l'onglet n'invente aucune échéance et reste cohérent avec
 * Administration » Vaccination. « Générer le calendrier » matérialise les doses manquantes en
 * « planifié » — pratique à l'ouverture d'un carnet pédiatrique, et sans effet sur les doses déjà
 * saisies (idempotent).
 */
import React from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, RefreshCw, Syringe } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Button, Card, EmptyState } from '@/components/ui';
import { useAuth } from '@/stores/auth';
import { CoverageList, CoverageSummaryBar, type CoverageLine } from '@/components/vaccination-card';
import { GeneratePlanButton, VaccinationDosesModule } from '@/components/vaccination-crud';

interface Carnet {
  patient: { id: number; code: string; fullName: string; birthDate: string | null };
  enabled: boolean;
  summary: { vaccines: number; mandatory: number; complete: number; overdue: number; dosesDone: number; dosesExpected: number; percent: number };
  coverage: CoverageLine[];
  doses: { id: number; code: string; vaccine_key: string; dose_no: number; status: string }[];
}

export function VaccinationTab({ pid }: { pid: number }): React.ReactElement {
  const { t } = useT('patient');
  const has = useAuth((s) => s.has);
  const qc = useQueryClient();
  const canView = has('vaccination', 'view');

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
  };

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="flex items-center gap-2 text-[14px] font-bold">
            <Syringe size={15} className="text-[rgb(var(--c-primary))]" /> {t('vax.coverage')}
          </h3>
          <span className="text-[11.5px] text-[rgb(var(--c-muted))]">
            {carnet.data?.patient.birthDate ? t('vax.birthDate', { date: carnet.data.patient.birthDate }) : t('vax.noBirthDate')}
          </span>
          <div className="ms-auto flex items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={refresh} title={t('vax.refresh')} aria-label={t('vax.refresh')}>
              <RefreshCw size={13} />
            </Button>
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

      {carnet.data ? <CoverageList coverage={carnet.data.coverage} /> : null}

      <VaccinationDosesModule pid={pid} title={t('vax.doses')} subtitle={t('vax.dosesHint')} onSaved={refresh} />
    </div>
  );
}
