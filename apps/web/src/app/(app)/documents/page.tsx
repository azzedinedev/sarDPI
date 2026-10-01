'use client';
/** GED — documents numérisés par type (ANL, IMG, DOC…) : upload multi-fichiers, versions, prévisualisation, QR/lien signé. */
import React, { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileCheck2, History, Link2, ScanLine, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Badge, Button } from '@/components/ui';
import { BizCode } from '@/components/biz-code';
import { CrudModule, fmtVal } from '@/components/crud';
import { Dialog } from '@/components/dialogs';
import { useToast } from '@/components/toast';
import { useAuth } from '@/stores/auth';

export default function DocumentsPage(): React.ReactElement {
  const { t } = useT('patient');
  const { t: tc } = useT('common');
  const toast = useToast();
  const has = useAuth((s) => s.has);
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [scan, setScan] = useState<string | null>(null);
  const [busy, setBusy] = useState(0);

  const uploadMany = async (files: FileList | File[]): Promise<void> => {
    const arr = Array.from(files);
    setBusy(arr.length);
    for (const f of arr) {
      const fd = new FormData();
      fd.set('typePrefix', 'DOC');
      fd.set('title', f.name);
      fd.set('file', f);
      try {
        await api.upload('/ged/upload', fd);
      } catch {
        toast.error(`${f.name} ✗`);
      }
      setBusy((b) => b - 1);
    }
    toast.success(tc('saved'));
    void qc.invalidateQueries({ queryKey: ['list', 'ged'] });
  };

  return (
    <>
      <CrudModule
        resource="ged"
        title={t('ged.title')}
        subtitle={t('ged.subtitle')}
        scopeSelect
        defaultSort={{ id: 'id', desc: true }}
        canArchive={has('ged', 'archive')}
        canDelete={false}
        createLabel={t('ged.upload')}
        cardTitle={(r) => fmtVal(r.title)}
        cardSubtitle={(r) => <BizCode code={r.code as string} />}
        cardBadges={(r) => <Badge tone="info">{fmtVal(r.type_label ?? r.type_prefix)}</Badge>}
        columns={[
          { key: 'code', label: tc('code'), width: '130px', render: (r) => <BizCode code={r.code as string} copy /> },
          { key: 'title', label: tc('title'), render: (r) => <span className="font-semibold">{fmtVal(r.title)}</span> },
          { key: 'type_prefix', label: t('ged.type'), width: '80px', render: (r) => <Badge tone="info">{fmtVal(r.type_prefix)}</Badge> },
          { key: 'patient_code', label: t('field.patient'), width: '120px', render: (r) => (r.patient_code ? <BizCode code={r.patient_code as string} /> : '—') },
          { key: 'file_size', label: tc('size'), width: '84px', render: (r) => <span className="font-mono text-[12px]">{r.file_size ? `${Math.round(Number(r.file_size) / 1024)} Ko` : '—'}</span> },
          { key: 'version', label: t('ged.version'), width: '70px', hideByDefault: true, render: (r) => <span className="font-mono">v{fmtVal(r.version ?? 1)}</span> },
          { key: 'created_at', label: tc('createdAt'), width: '140px', sortable: true, render: (r) => <span className="font-mono text-[11.5px] text-[rgb(var(--c-muted))]">{fmtVal(r.created_at).slice(0, 16)}</span> },
        ]}
        filterFields={[
          { field: 'type_prefix', label: t('ged.type'), kind: 'select', options: ['ANL', 'IMG', 'PDF', 'DOC', 'CPT', 'RPT', 'ADM'].map((v) => ({ value: v, label: v })) },
        ]}
        rowMenu={(r, close) => <GedActions id={Number(r.id)} code={String(r.code)} close={close} />}
        toolbarExtra={
          <>
            <input ref={fileRef} type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={(e) => e.target.files && void uploadMany(e.target.files)} />
            <Button size="sm" variant="primary" onClick={() => fileRef.current?.click()} disabled={busy > 0}>
              <Upload size={14} /> {busy > 0 ? `…${busy}` : t('ged.upload')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setScan('')}>
              <ScanLine size={14} /> {t('ged.scan')}
            </Button>
          </>
        }
      />
      <ScanDialog open={scan !== null} onClose={() => setScan(null)} initial={scan ?? ''} />
    </>
  );
}

function GedActions({ id, code, close }: { id: number; code: string; close: () => void }): React.ReactElement {
  const { t } = useT('patient');
  const [ver, setVer] = useState(false);
  return (
    <>
      <button
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-[13px] font-medium hover:bg-[rgb(var(--c-surface-2))]"
        onClick={() => {
          close();
          void api
            .get<{ url: string }>(`/ged/${id}/url`)
            .then((x) => window.open(x.url, '_blank'))
            .catch(() => undefined);
        }}
      >
        <FileCheck2 size={14} /> {t('ged.open')}
      </button>
      <button
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-[13px] font-medium hover:bg-[rgb(var(--c-surface-2))]"
        onClick={() => {
          close();
          void navigator.clipboard.writeText(`${window.location.origin}/api/v1/documents/${encodeURIComponent(code)}/print`);
        }}
      >
        <Link2 size={14} /> {t('ged.copyPrintUrl')}
      </button>
      <button
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-[13px] font-medium hover:bg-[rgb(var(--c-surface-2))]"
        onClick={() => {
          close();
          setVer(true);
        }}
      >
        <History size={14} /> {t('ged.versions')}
      </button>
      <VersionsDialog id={id} open={ver} onClose={() => setVer(false)} />
    </>
  );
}

function VersionsDialog({ id, open, onClose }: { id: number; open: boolean; onClose: () => void }): React.ReactElement {
  const { t } = useT('patient');
  const { lang } = useT('common');
  const q = useQuery({ queryKey: ['ged-versions', id], queryFn: () => api.get<{ rows: { id: number; version: number; created_at: string; title?: string; comment?: string | null }[] }>(`/ged/${id}/versions`), enabled: open });
  const [newFile, setNewFile] = useState<File | null>(null);
  const mut = useMutation({
    mutationFn: async () => {
      if (!newFile) return null;
      const fd = new FormData();
      fd.set('file', newFile);
      return api.upload(`/ged/${id}/version`, fd);
    },
    onSuccess: () => setNewFile(null),
  });
  void lang;
  return (
    <Dialog open={open} onClose={onClose} title={t('ged.versions')}>
      <ul className="mb-3 flex flex-col gap-1.5">
        {(q.data?.rows ?? []).map((v) => (
          <li key={v.id} className="flex items-center gap-2 rounded-xl bg-[rgb(var(--c-surface-2))] px-3 py-2 text-[12.5px]">
            <Badge tone="info">v{v.version}</Badge>
            <span className="font-mono text-[11.5px]">{fmtVal(v.created_at).slice(0, 16)}</span>
            <span className="ms-auto text-[rgb(var(--c-muted))]">{fmtVal(v.comment)}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <input type="file" className="field flex-1" onChange={(e) => setNewFile(e.target.files?.[0] ?? null)} />
        <Button variant="primary" disabled={!newFile} loading={mut.isPending} onClick={() => mut.mutate()}>
          {t('ged.addVersion')}
        </Button>
      </div>
    </Dialog>
  );
}

function ScanDialog({ open, onClose, initial }: { open: boolean; onClose: () => void; initial: string }): React.ReactElement {
  const { t } = useT('patient');
  const [code, setCode] = useState(initial);
  const [res, setRes] = useState<{ found: boolean; kind?: string; id?: number; patient?: { id: number; code: string; name: string } } | null>(null);
  const mut = useMutation({
    mutationFn: () => api.get<{ found: boolean; kind?: string; id?: number; patient?: { id: number; code: string; name: string } }>(`/scan`, { code }),
    onSuccess: (r) => setRes(r),
  });
  return (
    <Dialog open={open} onClose={onClose} title={t('ged.scan')}>
      <div className="flex flex-col gap-3">
        <input className="field font-mono" autoFocus placeholder="PAT-00001 / LAB-… / ANL-…" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && mut.mutate()} />
        <Button variant="primary" disabled={code.trim().length < 3} loading={mut.isPending} onClick={() => mut.mutate()}>
          <ScanLine size={14} /> {t('ged.scanGo')}
        </Button>
        {res ? (
          res.found ? (
            <button className="rounded-xl border border-[rgb(var(--c-ok)/0.4)] bg-[rgb(var(--c-ok-soft))] px-3 py-2 text-start text-[13px] font-semibold" onClick={() => (window.location.href = `/patients/${res.patient?.id ?? res.id ?? ''}`)}>
              ✓ {fmtVal(res.patient?.name)} · <span dir="ltr" className="font-mono">{fmtVal(res.patient?.code)}</span>
            </button>
          ) : (
            <p className="rounded-xl bg-[rgb(var(--c-coral-soft))] px-3 py-2 text-[13px] font-semibold text-[rgb(var(--c-coral))]">✗ {t('ged.notFound')}</p>
          )
        ) : null}
      </div>
    </Dialog>
  );
}
