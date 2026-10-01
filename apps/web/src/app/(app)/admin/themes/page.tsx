'use client';
/** Thèmes — /themes/<nom>/theme.json validé (Zod, rejet propre), activation, approbation JS (sha256), aperçu temps réel, éditeur. */
import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Palette, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Badge, Button, Card, Field, Textarea } from '@/components/ui';
import { Dialog } from '@/components/dialogs';
import { useToast } from '@/components/toast';
import { useAuth } from '@/stores/auth';

interface ThemeEntry {
  manifest: { name: string; label?: Record<string, string>; colors?: Record<string, string>; fontStack?: Record<string, string> };
  css: string;
  js: string | null;
  sha256: string;
  dir: string;
}
interface Scan {
  themes: ThemeEntry[];
  issues: { dir: string; error: string }[];
  scannedAt: string;
}

export default function ThemesAdminPage(): React.ReactElement {
  const { t } = useT('settings');
  const { t: tc } = useT('common');
  const { lang } = useT('common');
  const toast = useToast();
  const qc = useQueryClient();
  const has = useAuth((s) => s.has);
  const q = useQuery({ queryKey: ['themes-scan'], queryFn: () => api.get<Scan>('/admin/themes') });
  const [edit, setEdit] = useState<{ name: string; json: string; css: string } | null>(null);

  const active = q.data?.themes.find((x) => x.manifest.name === 'medical-blue');
  void active;

  const activate = useMutation({
    mutationFn: (name: string) => api.post('/admin/themes/activate', { name }),
    onSuccess: async () => {
      toast.success(tc('saved'));
      try {
        const css = await api.get<{ css: string }>('/admin/themes/active-css');
        const el = document.getElementById('sardpi-theme') ?? document.createElement('style');
        el.id = 'sardpi-theme';
        el.textContent = css.css;
        if (!el.parentNode) document.head.appendChild(el);
      } catch {
        /* l'API applique au prochain rendu */
      }
      void qc.invalidateQueries({ queryKey: ['themes-scan'] });
    },
    onError: () => toast.error(t('themes.rejected')),
  });
  const rescan = useMutation({
    mutationFn: () => api.post('/admin/themes/rescan', {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['themes-scan'] }),
  });
  const approve = useMutation({
    mutationFn: ({ name, sha256 }: { name: string; sha256: string }) => api.post('/admin/themes/approve', { name, sha256 }),
    onSuccess: () => {
      toast.success(tc('saved'));
      void qc.invalidateQueries({ queryKey: ['themes-scan'] });
    },
  });

  const jsPendingDirs = useMemo(() => new Set((q.data?.issues ?? []).filter((i) => i.error.includes('scripts.js')).map((i) => i.dir)), [q.data]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[20px] font-bold">
            <Palette size={19} className="text-[rgb(var(--c-primary))]" /> {t('admin.themes')}
          </h1>
          <p className="text-[12.5px] text-[rgb(var(--c-muted))]">{t('themes.subtitle')}</p>
        </div>
        <Button className="ms-auto" size="sm" variant="ghost" loading={rescan.isPending} onClick={() => rescan.mutate()}>
          <RefreshCw size={14} /> {t('themes.rescan')}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(q.data?.themes ?? []).map((th) => {
          const pendingJs = jsPendingDirs.has(th.dir);
          return (
            <Card key={th.dir} className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <b className="text-[14px]">{th.manifest.label?.[lang] ?? th.manifest.label?.fr ?? th.manifest.name}</b>
                <Badge tone="neutral" className="ms-auto font-mono">{th.manifest.name}</Badge>
              </div>
              <div className="flex gap-1">
                {(th.manifest.colors ? Object.entries(th.manifest.colors).slice(0, 8) : []).map(([k, v]) => (
                  <span key={k} title={k} className="h-5 w-5 rounded-full border border-black/10" style={{ background: String(v) }} />
                ))}
              </div>
              {th.manifest.colors?.['--c-bg'] === undefined && th.css ? (
                <p dir="ltr" className="line-clamp-2 rounded-lg bg-[rgb(var(--c-surface-2))] p-2 font-mono text-[10px] leading-tight text-[rgb(var(--c-muted))]">
                  {th.css.slice(0, 160)}…
                </p>
              ) : null}
              <div className="text-[11.5px]">
                {th.js ? (
                  <Badge tone="ok">
                    <ShieldCheck size={11} /> {t('themes.jsApproved')}
                  </Badge>
                ) : pendingJs ? (
                  <>
                    <Badge tone="warn">{t('themes.jsPending')}</Badge>
                    {has('themes', 'update') ? (
                      <button className="ms-2 font-bold text-[rgb(var(--c-primary))] underline-offset-2 hover:underline" onClick={() => approve.mutate({ name: th.dir, sha256: th.sha256 })}>
                        {t('themes.approve')}
                      </button>
                    ) : null}
                  </>
                ) : (
                  <span className="text-[rgb(var(--c-muted))]">JS —</span>
                )}
              </div>
              <div className="mt-auto flex gap-1.5 pt-1">
                {has('themes', 'update') ? (
                  <Button size="sm" variant="primary" onClick={() => activate.mutate(th.manifest.name)} loading={activate.isPending}>
                    <CheckCircle2 size={13} /> {t('themes.activate')}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEdit({ name: th.manifest.name, json: JSON.stringify(th.manifest, null, 2), css: th.css })}
                >
                  {tc('edit')}
                </Button>
              </div>
            </Card>
          );
        })}
        {(q.data?.issues ?? []).map((iss, i) => (
          <Card key={`${iss.dir}-${i}`} className="border-[rgb(var(--c-coral)/0.4)]">
            <b className="text-[13px]">⚠ /themes/{iss.dir}</b>
            <p dir="ltr" className="mt-1 rounded-lg bg-[rgb(var(--c-coral-soft))] p-2 font-mono text-[10.5px] leading-snug text-[rgb(var(--c-coral))]">
              {iss.error}
            </p>
            <p className="mt-1 text-[11px] text-[rgb(var(--c-muted))]">{t('themes.rejectedHint')}</p>
          </Card>
        ))}
      </div>
      <p className="text-[11.5px] text-[rgb(var(--c-muted))]">{t('themes.dropHint')}</p>

      <Dialog
        open={Boolean(edit)}
        onClose={() => setEdit(null)}
        title={`${t('themes.edit')} — ${edit?.name ?? ''}`}
        wide
        footer={
          <>
            <Button onClick={() => setEdit(null)}>{tc('cancel')}</Button>
            <Button
              variant="primary"
              onClick={() => {
                if (!edit) return;
                let manifest: Record<string, unknown>;
                try {
                  manifest = JSON.parse(edit.json) as Record<string, unknown>;
                } catch {
                  toast.error(t('themes.invalidJson'));
                  return;
                }
                void api
                  .post('/admin/themes', { name: manifest.name ?? edit.name, manifest, css: edit.css })
                  .then(() => {
                    toast.success(tc('saved'));
                    setEdit(null);
                    void qc.invalidateQueries({ queryKey: ['themes-scan'] });
                  })
                  .catch(() => toast.error(t('themes.rejected')));
              }}
            >
              <Save size={14} /> {tc('save')}
            </Button>
          </>
        }
      >
        {edit ? (
          <div className="grid gap-2 md:grid-cols-2">
            <Field label="theme.json">
              <Textarea rows={16} value={edit.json} onChange={(e) => setEdit({ ...edit, json: e.target.value })} className="font-mono !text-[11.5px]" />
            </Field>
            <Field label="styles.css">
              <Textarea rows={16} value={edit.css} onChange={(e) => setEdit({ ...edit, css: e.target.value })} className="font-mono !text-[11.5px]" />
            </Field>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
