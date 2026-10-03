'use client';
/** Tableau de bord : compteurs, RDV du jour, dossiers récents, alertes (clés i18n manquantes, jobs en échec). */
import React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Activity, AlertTriangle, CalendarClock, CheckCircle2, Clock, FileWarning, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { BizCode } from '@/components/biz-code';
import { fmtDateTime } from '@/lib/format';

interface Dash {
  counts: Record<string, number>;
  todayAppointments: { code: string | null; startsAt: string; patient: string | null; status: string | null }[];
  recentRecords: { code: string; title: string | null; actDate: string; category: string | null }[];
  alerts: { failedJobs: number; missingKeys: number; licenseState?: string };
}

export default function DashboardPage(): React.ReactElement {
  const { t } = useT('common');
  const { t: tp } = useT('patient');
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dash>('/dashboard') });
  const d = q.data;

  if (q.isLoading) {
    return (
      <div className="grid gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-28" />
        ))}
      </div>
    );
  }

  const stats = [
    { key: 'patients', label: t('dash.patients'), icon: Users, href: '/patients' },
    { key: 'recordsToday', label: t('dash.recordsToday'), icon: Activity, href: '/records' },
    { key: 'appointmentsToday', label: t('dash.appointmentsToday'), icon: CalendarClock, href: '/calendar' },
    { key: 'messagesFailed', label: t('dash.messagesFailed'), icon: AlertTriangle, href: '/messages' },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((s, i) => (
          <motion.div key={s.key} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
            <Link href={s.href} className="glass-card list-card flex items-center gap-3 p-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[rgb(var(--c-primary)/0.12)] text-[rgb(var(--c-primary))]">
                <s.icon size={20} />
              </span>
              <span className="min-w-0">
                <span className="block font-mono text-[22px] font-bold leading-none">{((d?.counts as Record<string, number> | undefined)?.[s.key] ?? 0).toLocaleString()}</span>
                <span className="block truncate text-[12px] font-semibold text-[rgb(var(--c-muted))]">{s.label}</span>
              </span>
            </Link>
          </motion.div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="glass-card p-4 lg:col-span-2">
          <h2 className="mb-2 flex items-center gap-2 text-[14px] font-bold">
            <CalendarClock size={15} className="text-[rgb(var(--c-primary))]" /> {t('dash.agendaToday')}
          </h2>
          {!d?.todayAppointments?.length ? (
            <p className="rounded-xl bg-[rgb(var(--c-surface-2))] p-3 text-[12.5px] text-[rgb(var(--c-muted))]">{t('dash.noAgenda')}</p>
          ) : (
            <ul className="flex flex-col">
              {d.todayAppointments.slice(0, 8).map((a, i) => (
                <li key={i} className="flex items-center gap-3 border-b border-[rgb(var(--c-line)/0.5)] py-2 last:border-0">
                  <Clock size={14} className="text-[rgb(var(--c-muted))]" />
                  <span className="font-mono text-[12.5px]">{fmtDateTime(a.startsAt, 'fr').slice(-5)}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{a.patient ?? '—'}</span>
                  {a.code ? <BizCode code={a.code} /> : null}
                  <span className={`badge ${a.status === 'confirmed' ? 'text-[rgb(var(--c-ok))]' : ''}`}>{t(`appt.status.${a.status}`)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="glass-card p-4">
            <h2 className="mb-2 flex items-center gap-2 text-[14px] font-bold">
              <FileWarning size={15} className="text-[rgb(var(--c-amber))]" /> {t('dash.recentRecords')}
            </h2>
            {!d?.recentRecords?.length ? <p className="text-[12.5px] text-[rgb(var(--c-muted))]">{tp('history.empty')}</p> : (
              <ul className="flex flex-col gap-1.5">
                {d.recentRecords.slice(0, 6).map((r) => (
                  <li key={r.code} className="flex items-center gap-2 text-[12.5px]">
                    <CheckCircle2 size={13} className="shrink-0 text-[rgb(var(--c-ok))]" />
                    <span className="min-w-0 flex-1 truncate">{r.title ?? r.category ?? '—'}</span>
                    <BizCode code={r.code} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="glass-card p-4">
            <h2 className="mb-2 text-[14px] font-bold">{t('dash.system')}</h2>
            <ul className="flex flex-col gap-1.5 text-[12.5px]">
              <li className="flex justify-between"><span>{t('dash.failedJobs')}</span><b className={d?.alerts.failedJobs ? 'text-[rgb(var(--c-coral))]' : 'text-[rgb(var(--c-ok))]'}>{d?.alerts.failedJobs ?? 0}</b></li>
              <li className="flex justify-between"><span>{t('dash.missingKeys')}</span><b className={d?.alerts.missingKeys ? 'text-[rgb(var(--c-amber))]' : 'text-[rgb(var(--c-ok))]'}>{d?.alerts.missingKeys ?? 0}</b></li>
              {d?.alerts.licenseState ? <li className="flex justify-between"><span>{t('license.state')}</span><b>{d.alerts.licenseState}</b></li> : null}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
