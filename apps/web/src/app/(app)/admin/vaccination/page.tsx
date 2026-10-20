'use client';
/**
 * ADMINISTRATION » VACCINATION — le carnet vaccinal devient un module d'administration à part
 * entière (il n'est plus une simple section de Paramètres) :
 *
 *   ONGLET « Calendrier vaccinal »  le réglage `vaccination` (activation + liste des vaccins :
 *                                   libellés 4 langues, âge recommandé en mois ET en semaines,
 *                                   nombre de doses, intervalle, obligatoire). C'est lui qui pilote
 *                                   les échéances calculées dans chaque dossier patient. Un bouton
 *                                   restaure le calendrier national (profil pays DZ) en une fois.
 *   ONGLET « Carnets des patients » toutes les doses enregistrées, tous patients confondus :
 *                                   recherche, filtres, tri, export CSV, archivage, et ouverture du
 *                                   dossier patient en un clic.
 *
 * Le rattachement au dossier patient est double : chaque dose porte `patient_id` (obligatoire à la
 * création, contrôlé côté API) et chaque dose écrit un événement dans l'historique clinique du
 * patient (kind « vaccination ») — le carnet se lit donc aussi dans le fil du dossier.
 *
 * Permissions : le module `vaccination` gouverne les carnets ; l'édition du calendrier reste un
 * réglage (`setting:view` / `setting:update`) — un infirmier saisit les doses sans pouvoir réécrire
 * le calendrier national, l'onglet lui est alors masqué (aucun bouton mort à l'écran).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, RotateCcw, Syringe, Users } from 'lucide-react';
import { DEFAULT_VACCINATION_SCHEDULE } from '@sardpi/shared';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Badge, Button, Card, Tabs } from '@/components/ui';
import { SaveBar } from '@/components/save-bar';
import { Dialog } from '@/components/dialogs';
import { useToast } from '@/components/toast';
import { useAuth } from '@/stores/auth';
import { SettingsForm } from '@/components/settings-form';
import { issuesByPath, issuesVarsByPath } from '@/lib/settings-fields';
import { VaccinationDosesModule } from '@/components/vaccination-crud';

interface Stats {
  total: number;
  done: number;
  planned: number;
  patients: number;
  enabled: boolean;
  scheduleCount: number;
  mandatoryCount: number;
  expectedDoses: number;
}

export default function AdminVaccinationPage(): React.ReactElement {
  const { t } = useT('settings');
  const has = useAuth((s) => s.has);
  const canSettings = has('setting', 'view');
  const canDoses = has('vaccination', 'view');
  const [tab, setTab] = useState<'schedule' | 'doses'>(canSettings ? 'schedule' : 'doses');

  const stats = useQuery({ queryKey: ['vaccination-stats'], queryFn: () => api.get<Stats>('/vaccinations/stats') });

  const tabs = useMemo(() => {
    const out: { key: 'schedule' | 'doses'; label: string; badge?: number }[] = [];
    if (canSettings) out.push({ key: 'schedule', label: t('vaccination.tab.schedule'), badge: stats.data?.scheduleCount });
    if (canDoses) out.push({ key: 'doses', label: t('vaccination.tab.doses'), badge: stats.data?.total });
    return out;
  }, [canSettings, canDoses, stats.data, t]);

  const active = tabs.some((x) => x.key === tab) ? tab : (tabs[0]?.key ?? 'schedule');

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-[20px] font-bold">
            <Syringe size={20} className="text-[rgb(var(--c-primary))]" /> {t('admin.vaccination')}
          </h1>
          <p className="text-[12.5px] text-[rgb(var(--c-muted))]">{t('vaccination.subtitle')}</p>
        </div>
        {stats.data && !stats.data.enabled ? <Badge tone="warn"><AlertTriangle size={11} /> {t('vaccination.disabled')}</Badge> : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Syringe} label={t('vaccination.stat.schedule')} value={stats.data?.scheduleCount} hint={t('vaccination.stat.scheduleHint', { count: stats.data?.mandatoryCount ?? 0 })} />
        <StatCard icon={CheckCircle2} label={t('vaccination.stat.done')} value={stats.data?.done} hint={t('vaccination.stat.doneHint', { count: stats.data?.planned ?? 0 })} />
        <StatCard icon={Users} label={t('vaccination.stat.patients')} value={stats.data?.patients} hint={t('vaccination.stat.patientsHint')} />
        <StatCard icon={AlertTriangle} label={t('vaccination.stat.expected')} value={stats.data?.expectedDoses} hint={t('vaccination.stat.expectedHint')} />
      </div>

      {tabs.length > 1 ? <Tabs active={active} onChange={(k) => setTab(k as 'schedule' | 'doses')} tabs={tabs} /> : null}

      {active === 'schedule' ? (canSettings ? <ScheduleEditor /> : <Forbidden text={t('vaccination.forbiddenSettings')} />) : null}
      {active === 'doses' ? (
        canDoses ? (
          <VaccinationDosesModule
            title={t('vaccination.tab.doses')}
            subtitle={t('vaccination.dosesHint')}
            rowHrefToPatient
          />
        ) : (
          <Forbidden text={t('vaccination.forbidden')} />
        )
      ) : null}
    </div>
  );
}

function Forbidden({ text }: { text: string }): React.ReactElement {
  return (
    <Card className="flex items-center gap-2 p-4 text-[13px] text-[rgb(var(--c-muted))]">
      <AlertTriangle size={15} className="text-[rgb(var(--c-amber))]" /> {text}
    </Card>
  );
}

function StatCard({ icon: Icon, label, value, hint }: { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; value?: number; hint?: string }): React.ReactElement {
  return (
    <Card soft className="flex items-center gap-3 p-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[rgb(var(--c-primary)/0.12)] text-[rgb(var(--c-primary))]">
        <Icon size={16} />
      </span>
      <span className="min-w-0">
        <span className="block text-[18px] font-bold leading-tight tabular-nums">{value ?? '—'}</span>
        <span className="block truncate text-[12px] font-semibold">{label}</span>
        {hint ? <span className="block truncate text-[11px] text-[rgb(var(--c-muted))]">{hint}</span> : null}
      </span>
    </Card>
  );
}

/**
 * Éditeur du calendrier vaccinal — MÊME formulaire par spécification que les autres réglages
 * (`SettingsForm` + `issuesByPath`) et MÊME endpoint (`PUT /admin/settings/vaccination`) : la
 * validation est celle du serveur, l'écran ne peut pas s'en écarter.
 */
function ScheduleEditor(): React.ReactElement {
  const { t } = useT('settings');
  const { t: tc } = useT('common');
  const toast = useToast();
  const qc = useQueryClient();
  const has = useAuth((s) => s.has);
  const canEdit = has('setting', 'update');

  const q = useQuery({ queryKey: ['settings', 'vaccination'], queryFn: () => api.get<Record<string, unknown>>('/admin/settings/vaccination') });
  const [data, setData] = useState<Record<string, unknown>>({});
  const [baseline, setBaseline] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);

  const errors = useMemo(() => issuesByPath('vaccination', data), [data]);
  const errVars = useMemo(() => issuesVarsByPath('vaccination', data), [data]);
  const invalid = Object.keys(errors).length;
  const dirty = JSON.stringify(data) !== baseline;

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.put<{ value?: Record<string, unknown> }>('/admin/settings/vaccination', payload),
    onSuccess: (res) => {
      toast.success(tc('saved'));
      const next = res?.value && typeof res.value === 'object' ? res.value : data;
      setData(next);
      setBaseline(JSON.stringify(next));
      void qc.invalidateQueries({ queryKey: ['settings', 'vaccination'] });
      // le carnet de chaque patient dépend du calendrier : libellés et échéances sont recalculés
      void qc.invalidateQueries({ queryKey: ['vaccination-calendar'] });
      void qc.invalidateQueries({ queryKey: ['vaccination-stats'] });
      void qc.invalidateQueries({ queryKey: ['vaccination-carnet'] });
      void qc.invalidateQueries({ queryKey: ['list', 'vaccinations'] });
    },
    onError: (e: unknown) => {
      const x = e as { code?: string };
      toast.error(tc(`errors.${x.code ?? 'validation'}`));
    },
  });

  const resetToNational = useMutation({
    mutationFn: () => api.put<{ value?: Record<string, unknown> }>('/admin/settings/vaccination', { enabled: true, schedule: DEFAULT_VACCINATION_SCHEDULE }),
    onSuccess: () => {
      setConfirmReset(false);
      toast.success(t('vaccination.restored'));
      void qc.invalidateQueries({ queryKey: ['settings', 'vaccination'] });
      void qc.invalidateQueries({ queryKey: ['vaccination-calendar'] });
      void qc.invalidateQueries({ queryKey: ['vaccination-stats'] });
    },
    onError: () => {
      setConfirmReset(false);
      toast.error(tc('errors.errors.server'));
    },
  });

  /**
   * Une réponse serveur identique à la référence ne doit pas écraser une saisie en cours ; une
   * réponse différente (après enregistrement, ou restauration du calendrier national) fait foi.
   */
  useEffect(() => {
    if (!q.data || save.isPending || resetToNational.isPending) return;
    const snap = JSON.stringify(q.data);
    if (snap === baseline) return;
    setBaseline(snap);
    setData(q.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  if (q.isLoading) {
    return (
      <Card className="flex flex-col gap-3">
        <div className="skeleton h-6 w-52" />
        <div className="skeleton h-52 w-full" />
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold">{t('vaccination.tab.schedule')}</h2>
          <p className="text-[12px] text-[rgb(var(--c-muted))]">{t('vaccination.scheduleHint')}</p>
        </div>
        {canEdit ? (
          <Button className="ms-auto" size="sm" variant="ghost" onClick={() => setConfirmReset(true)} loading={resetToNational.isPending}>
            <RotateCcw size={14} /> {t('vaccination.restoreNational')}
          </Button>
        ) : null}
      </div>

      {invalid > 0 ? (
        <ul className="rounded-xl bg-[rgb(var(--c-coral-soft))] px-3 py-2 font-mono text-[11.5px] font-bold text-[rgb(var(--c-coral))]">
          {Object.entries(errors).map(([path, code]) => (
            <li key={path}>
              {path === '_' ? '' : `${path} : `}
              {t(`settings.validation.${code}`, errVars[path] ?? {})}
            </li>
          ))}
        </ul>
      ) : null}

      <SettingsForm section="vaccination" data={data} onChange={setData} errors={errors} />

      <SaveBar
        dirty={dirty}
        saving={save.isPending}
        invalidCount={invalid}
        disabled={!canEdit}
        onSave={() => save.mutate(data)}
        onReset={() => {
          setData(q.data ?? {});
        }}
      />

      <Dialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title={t('vaccination.restoreTitle')}
        footer={
          <>
            <Button onClick={() => setConfirmReset(false)}>{tc('cancel')}</Button>
            <Button variant="primary" loading={resetToNational.isPending} onClick={() => resetToNational.mutate()}>
              <RotateCcw size={14} /> {t('vaccination.restoreNational')}
            </Button>
          </>
        }
      >
        <p className="text-[13.5px]">{t('vaccination.restoreHint', { count: DEFAULT_VACCINATION_SCHEDULE.length })}</p>
      </Dialog>
    </Card>
  );
}
