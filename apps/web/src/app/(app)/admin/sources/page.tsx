'use client';
/** Imports externes (confrères, labo, imagerie…) — sources configurables avec mapping JSON + test de connexion (6 s max) + job d’import. */
import React from 'react';
import { PlayCircle, Zap } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Badge } from '@/components/ui';
import { CrudModule, fmtVal } from '@/components/crud';
import { useToast } from '@/components/toast';
import { useAuth } from '@/stores/auth';

export default function ExternalSourcesPage(): React.ReactElement {
  const { t } = useT('settings');
  const { t: tc } = useT('common');
  const toast = useToast();
  const has = useAuth((s) => s.has);
  return (
    <CrudModule
      resource="external-sources"
      title={t('admin.sources')}
      subtitle={t('sources.subtitle')}
      canCreate={has('external', 'create')}
      canArchive={false}
      canExport={false}
      defaultSort={{ id: 'id', desc: true }}
      cardTitle={(r) => fmtVal(r.name)}
      cardBadges={(r) => (
        <>
          <Badge tone="info">{fmtVal(r.kind)}</Badge>
          {Number(r.active) === 1 ? <Badge tone="ok">{tc('active')}</Badge> : <Badge>{tc('inactive')}</Badge>}
        </>
      )}
      columns={[
        { key: 'name', label: tc('title'), sortable: true, render: (r) => <span className="font-semibold">{fmtVal(r.name)}</span> },
        { key: 'kind', label: t('sources.kind'), width: '100px', render: (r) => <Badge tone="info">{fmtVal(r.kind)}</Badge> },
        { key: 'base_url', label: 'base URL', hideByDefault: true, render: (r) => <span dir="ltr" className="font-mono text-[11.5px]">{fmtVal(r.base_url)}</span> },
        { key: 'test_path', label: 'test path', width: '110px', hideByDefault: true, render: (r) => <span dir="ltr" className="font-mono text-[11.5px]">{fmtVal(r.test_path)}</span> },
        { key: 'active', label: tc('active'), width: '80px', render: (r) => (Number(r.active) === 1 ? <Badge tone="ok">✓</Badge> : <Badge>—</Badge>) },
      ]}
      fields={[
        { key: 'name', label: tc('title'), required: true },
        { key: 'kind', label: t('sources.kind'), kind: 'select', options: [{ value: 'api', label: 'REST API' }, { value: 'csv', label: 'CSV/flux' }, { value: 'hl7', label: 'HL7 / FHIR' }] },
        { key: 'baseUrl', label: 'base URL', required: true, placeholder: 'http://192.168.1.40/api/v1' },
        { key: 'testPath', label: 'test path', placeholder: '/ping' },
        { key: 'authType', label: t('sources.auth'), kind: 'select', options: [{ value: 'none', label: '—' }, { value: 'apikey', label: 'X-Api-Key' }, { value: 'bearer', label: 'Bearer' }] },
        { key: 'authValue', label: `${t('sources.credential')} (${tc('settings.secretKeep')})`, kind: 'password', hint: t('sources.encrypted') },
        { key: 'mappingJson', label: t('sources.mapping'), kind: 'json', hint: t('sources.mappingHint'), colSpan: 2 },
        { key: 'active', label: tc('active'), kind: 'checkbox' },
      ]}
      transformCreate={(v) => ({ ...v, auth: { type: v.authType ?? 'none', value: v.authValue || undefined }, mapping: parseJson(v.mappingJson), authType: undefined, authValue: undefined, mappingJson: undefined })}
      transformUpdate={(v) => ({ ...v, ...(v.authValue ? { auth: { type: v.authType ?? 'none', value: v.authValue } } : {}), mapping: parseJson(v.mappingJson), authType: undefined, authValue: undefined, mappingJson: v.mappingJson ? undefined : undefined })}
      rowMenu={(r, close) => (
        <div className="border-t border-[rgb(var(--c-line)/0.6)] pt-1">
          <button
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-[13px] font-medium hover:bg-[rgb(var(--c-surface-2))]"
            onClick={async () => {
              close();
              try {
                const res = await api.post<{ ok: boolean; ms?: number; detail?: unknown }>(`/external-sources/${r.id}/test`, {});
                toast.success(`${res.ok ? '✓' : '✗'} ${res.ms ?? ''} ms`);
              } catch (e) {
                toast.error(t(`errors.${(e as { code?: string }).code ?? 'network'}`));
              }
            }}
          >
            <Zap size={14} /> {t('sources.test')}
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-[13px] font-medium hover:bg-[rgb(var(--c-surface-2))]"
            onClick={async () => {
              close();
              try {
                await api.post(`/external-sources/${r.id}/run`, {});
                toast.success(t('sources.queued'));
              } catch {
                toast.error('!');
              }
            }}
          >
            <PlayCircle size={14} /> {t('sources.run')}
          </button>
        </div>
      )}
    />
  );
}

function parseJson(v: unknown): Record<string, unknown> {
  if (!v) return {};
  try {
    return JSON.parse(String(v)) as Record<string, unknown>;
  } catch {
    return {};
  }
}
