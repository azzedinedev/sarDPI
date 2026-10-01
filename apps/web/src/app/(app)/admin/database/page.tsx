'use client';
/**
 * Base de données — adaptateurs (MySQL / Postgres / JSON local — pas de cloud obligatoire),
 * test de connexion avec rollback automatique, migration « expand only » idempotente,
 * export/import JSON portables. Mode démo (JSON/localStorage/IndexedDB) clairement affiché.
 */
import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Database, Download, PlugZap, Rocket, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Badge, Button, Card, Field, Input, Select } from '@/components/ui';
import { useToast } from '@/components/toast';

export default function DatabaseAdminPage(): React.ReactElement {
  const { t } = useT('settings');
  const { t: tc } = useT('common');
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin-db'], queryFn: () => api.get<DbInfo>('/admin/db') });
  const [form, setForm] = useState<Partial<FormState>>({});
  const [importJson, setImportJson] = useState('');

  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; error?: string | null; ms?: number; adapter?: string }>('/admin/db/test', form),
    onSuccess: (h) => {
      if (h.ok) toast.success(`✓ ${h.adapter} (${h.ms} ms)`);
      else toast.error(`✗ ${h.error ?? 'connexion refusée — rollback appliqué'}`);
      void q.refetch();
    },
    onError: () => toast.error(t('db.testFailed')),
  });
  const migrate = useMutation({
    mutationFn: () => api.post<{ ok: boolean; applied?: number; skipped?: number; note?: string }>('/admin/db/migrate', {}),
    onSuccess: (r) => toast.success(r.note ?? `${t('db.migrateDone')} : +${r.applied} / skip ${r.skipped}`),
  });
  const importDb = useMutation({
    mutationFn: () => api.post<{ tables: number }>('/admin/db/import', JSON.parse(importJson)),
    onSuccess: (r) => toast.success(`${t('db.imported')} (${r.tables})`),
    onError: () => toast.error(t('db.importFailed')),
  });

  const info = q.data;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      <h1 className="flex items-center gap-2 text-[20px] font-bold">
        <Database size={19} className="text-[rgb(var(--c-primary))]" /> {t('admin.database')}
      </h1>

      <Card className="flex flex-wrap items-center gap-3">
        <Badge tone={info?.health.ok ? 'ok' : 'danger'}>{info?.health.ok ? '●' : '●'} {info?.health.adapter ?? '…'}</Badge>
        {info?.health.ok ? <span className="font-mono text-[12px] text-[rgb(var(--c-muted))]">{info.health.ms} ms</span> : <span className="text-[12px] text-[rgb(var(--c-coral))]">{String(info?.health.error ?? '')}</span>}
        {info?.health.demo ? <Badge tone="warn">{t('db.demoMode')}</Badge> : null}
        <span className="ms-auto text-[11.5px] text-[rgb(var(--c-muted))]">
          {t('db.storage')}: <code dir="ltr">{String(info?.overlay?.dataDir ?? 'DATA_DIR')}</code>
        </span>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-[14px] font-bold">{t('db.switch')}</h2>
        <p className="text-[12px] text-[rgb(var(--c-muted))]">{t('db.switchHint')}</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Adapter">
            <Select
              value={form.adapter ?? info?.config.adapter ?? 'json'}
              onChange={(e) => setForm((f) => ({ ...f, adapter: e.target.value }))}
              options={[
                { value: 'json', label: 'JSON (fichiers locaux)' },
                { value: 'memory', label: 'Memory (transitoire)' },
                { value: 'mysql', label: 'MySQL / MariaDB' },
                { value: 'postgres', label: 'PostgreSQL (URL)' },
              ]}
            />
          </Field>
          <div />
          {form.adapter === 'mysql' ? (
            <>
              <Field label="Host"><Input value={form.mysqlHost ?? ''} onChange={(e) => setForm((f) => ({ ...f, mysqlHost: e.target.value }))} placeholder="127.0.0.1" /></Field>
              <Field label="Port"><Input value={form.mysqlPort ?? '3306'} onChange={(e) => setForm((f) => ({ ...f, mysqlPort: e.target.value }))} /></Field>
              <Field label="Base"><Input value={form.mysqlDb ?? ''} onChange={(e) => setForm((f) => ({ ...f, mysqlDb: e.target.value }))} /></Field>
              <Field label="Utilisateur"><Input value={form.mysqlUser ?? ''} onChange={(e) => setForm((f) => ({ ...f, mysqlUser: e.target.value }))} /></Field>
              <Field label="Mot de passe"><Input type="password" value={form.mysqlPassword ?? ''} onChange={(e) => setForm((f) => ({ ...f, mysqlPassword: e.target.value }))} /></Field>
            </>
          ) : null}
          {form.adapter === 'postgres' ? (
            <Field label="postgresql://…" className="col-span-2">
              <Input dir="ltr" value={form.postgresUrl ?? ''} onChange={(e) => setForm((f) => ({ ...f, postgresUrl: e.target.value }))} placeholder="postgres://user:pass@127.0.0.1:5432/sardpi" />
            </Field>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button variant="primary" loading={test.isPending} onClick={() => test.mutate()}>
            <PlugZap size={14} /> {t('db.test')} (test + application, rollback auto)
          </Button>
          <Button variant="ghost" loading={migrate.isPending} onClick={() => migrate.mutate()}>
            <Rocket size={14} /> {t('db.migrate')}
          </Button>
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-[14px] font-bold">{t('db.portability')}</h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => void api.download('/admin/db/export', `sardpi-export-${new Date().toISOString().slice(0, 10)}.json`)}>
            <Download size={14} /> {t('db.export')}
          </Button>
        </div>
        <Field label={t('db.import')}>
          <textarea rows={6} dir="ltr" className="field font-mono !text-[11.5px]" placeholder='{ "patients": {"auto": 3, "rows": [...]}, … }' value={importJson} onChange={(e) => setImportJson(e.target.value)} />
        </Field>
        <div className="flex items-center gap-2">
          <Button variant="danger" disabled={importJson.length < 10} loading={importDb.isPending} onClick={() => importDb.mutate()}>
            <Upload size={14} /> {t('db.import')}
          </Button>
          <p className="text-[11.5px] text-[rgb(var(--c-muted))]">{t('db.importWarn')} — {tc('print')}: {info?.config.adapter}</p>
        </div>
      </Card>
    </div>
  );
}

interface DbInfo {
  config: { adapter: string; dataDir?: string };
  overlay: { adapter?: string; dataDir?: string; mysql?: Record<string, unknown> } | null;
  health: { ok: boolean; adapter?: string; ms?: number; demo?: boolean; error?: string | null };
}
interface FormState {
  adapter: string;
  mysqlHost: string;
  mysqlPort: string;
  mysqlDb: string;
  mysqlUser: string;
  mysqlPassword: string;
  postgresUrl: string;
}
