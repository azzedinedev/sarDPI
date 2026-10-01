'use client';
/** Système — file de jobs (retry/purge), journal d’audit (vérification de chaîne SHA-256), sauvegardes locales. */
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, CheckCircle2, DatabaseBackup, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Badge, Button, Card, Tabs } from '@/components/ui';
import { fmtVal } from '@/components/crud';
import { useToast } from '@/components/toast';

export default function SystemAdminPage(): React.ReactElement {
  const { t } = useT('settings');
  const [tab, setTab] = useState('jobs');
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-[20px] font-bold">{t('admin.systemTitle')}</h1>
      <Tabs active={tab} onChange={setTab} tabs={[{ key: 'jobs', label: t('admin.jobs') }, { key: 'audit', label: t('admin.audit') }, { key: 'backups', label: t('admin.backups') }]} />
      {tab === 'jobs' ? <JobsTab /> : tab === 'audit' ? <AuditTab /> : <BackupsTab />}
    </div>
  );
}

function JobsTab(): React.ReactElement {
  const { t } = useT('settings');
  const { t: tc } = useT('common');
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const q = useQuery({ queryKey: ['jobs', status], queryFn: () => api.get<{ rows: Record<string, unknown>[]; stats: Record<string, number> }>(`/admin/jobs${status ? `?status=${status}` : ''}`) });
  const retry = useMutation({
    mutationFn: (id: number) => api.post(`/admin/jobs/${id}/retry`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['jobs'] }),
  });
  const purge = useMutation({
    mutationFn: () => api.post('/admin/jobs/purge', {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
  const rows = q.data?.rows ?? [];
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {['', 'queued', 'running', 'done', 'failed'].map((s) => (
          <button key={s} className={`badge ${status === s ? 'border-[rgb(var(--c-primary))] font-bold' : ''}`} onClick={() => setStatus(s)}>
            {s || tc('all')} {q.data?.stats?.[s || 'all'] !== undefined ? `(${q.data.stats[s || 'all']})` : ''}
          </button>
        ))}
        <Button size="sm" variant="ghost" className="ms-auto" onClick={() => purge.mutate()}>
          <Trash2 size={13} /> {t('jobs.purge')}
        </Button>
      </div>
      <Card className="overflow-x-auto !p-0">
        <table className="dt-table">
          <thead>
            <tr>
              <th>#</th>
              <th>type</th>
              <th>état</th>
              <th>essais</th>
              <th>erreur</th>
              <th>prévu</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((j) => (
              <tr key={String(j.id)}>
                <td className="font-mono">{fmtVal(j.id)}</td>
                <td className="font-mono text-[12px]">{fmtVal(j.type)}</td>
                <td>
                  <Badge tone={j.status === 'done' ? 'ok' : j.status === 'failed' ? 'danger' : 'info'}>{fmtVal(j.status)}</Badge>
                </td>
                <td className="font-mono">{fmtVal(j.attempts)}/{fmtVal(j.max_attempts)}</td>
                <td className="max-w-[280px] truncate text-[11.5px] text-[rgb(var(--c-coral))]" title={String(j.error ?? '')}>
                  {fmtVal(j.error)}
                </td>
                <td className="font-mono text-[11px]">{fmtVal(j.run_at).slice(0, 16)}</td>
                <td className="text-end">
                  {j.status === 'failed' ? (
                    <Button size="sm" variant="ghost" className="btn-icon" onClick={() => retry.mutate(Number(j.id))}>
                      <RotateCcw size={13} />
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function AuditTab(): React.ReactElement {
  const { t: tc } = useT('common');
  const [q, setQ] = useState('');
  const query = useQuery({ queryKey: ['audit-admin', q], queryFn: () => api.get<{ rows: Record<string, unknown>[] }>(`/admin/audit${q ? `?q=${encodeURIComponent(q)}` : ''}`) });
  const verify = useMutation({ mutationFn: () => api.post<{ ok: boolean; checked: number; errorAt?: number }>('/admin/audit/verify', {}) });
  const [result, setResult] = React.useState<string | null>(null);
  const rows = query.data?.rows ?? [];
  return (
    <>
      <div className="flex items-center gap-2">
        <input className="field !min-h-9 max-w-sm" placeholder={tc('search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <Button size="sm" variant="primary" className="ms-auto" loading={verify.isPending} onClick={() => verify.mutate()}>
          <ShieldCheck size={14} /> {tc('verifyChain')}
        </Button>
        {result ? <span className="text-[12.5px] font-semibold">{result}</span> : null}
      </div>
      <Card className="max-h-[62vh] overflow-y-auto !p-0">
        <table className="dt-table">
          <thead className="sticky top-0">
            <tr>
              <th>#</th>
              <th>acteur</th>
              <th>action</th>
              <th>entité</th>
              <th>ip</th>
              <th>date</th>
              <th>∑</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={String(a.id)}>
                <td className="font-mono text-[11.5px]">{fmtVal(a.id)}</td>
                <td>{fmtVal(a.actor_id)}</td>
                <td dir="ltr" className="font-mono text-[11.5px]">{fmtVal(a.action)}</td>
                <td dir="ltr" className="font-mono text-[11px]">
                  {fmtVal(a.entity)}#{fmtVal(a.entity_id)}
                </td>
                <td dir="ltr" className="font-mono text-[11px]">{fmtVal(a.ip)}</td>
                <td className="font-mono text-[11px]">{fmtVal(a.at ?? a.created_at).slice(0, 19)}</td>
                <td title={`${fmtVal(a.hash)}`}>
                  <span dir="ltr" className="font-mono text-[10px] opacity-50">{String(a.hash ?? '').slice(0, 8)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function BackupsTab(): React.ReactElement {
  const { t } = useT('settings');
  const toast = useToast();
  const qc = useQueryClient();
  const files = useQuery({ queryKey: ['backups'], queryFn: () => api.get<{ files: { name: string; bytes: number }[] }>('/admin/backups') });
  const run = useMutation({
    mutationFn: () => api.post<{ jobId: number }>('/admin/backup', {}),
    onSuccess: () => {
      toast.success(t('backups.queued'));
      setTimeout(() => void qc.invalidateQueries({ queryKey: ['backups'] }), 3000);
    },
  });
  return (
    <>
      <div className="flex items-center gap-2">
        <Button variant="primary" loading={run.isPending} onClick={() => run.mutate()}>
          <DatabaseBackup size={14} /> {t('backups.run')}
        </Button>
        <span className="text-[12px] text-[rgb(var(--c-muted))]">{t('backups.hint')}</span>
      </div>
      <Card className="!p-0">
        {(files.data?.files ?? []).map((f) => (
          <div key={f.name} className="flex items-center gap-3 border-b border-[rgb(var(--c-line)/0.5)] px-4 py-2.5 last:border-0">
            <Archive size={14} className="text-[rgb(var(--c-muted))]" />
            <span dir="ltr" className="font-mono text-[12.5px]">{f.name}</span>
            <span className="ms-auto font-mono text-[11.5px] text-[rgb(var(--c-muted))]">{(f.bytes / 1024).toFixed(1)} Ko</span>
            <CheckCircle2 size={13} className="text-[rgb(var(--c-ok))]" />
          </div>
        ))}
        {!(files.data?.files ?? []).length ? <p className="p-6 text-center text-[12.5px] text-[rgb(var(--c-muted))]">{t('backups.empty')}</p> : null}
      </Card>
    </>
  );
}
