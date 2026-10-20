'use client';
/** Thèmes — /themes/<nom>/theme.json validé (Zod, rejet propre), activation, approbation JS (sha256), aperçu temps réel, éditeur. */
import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Palette, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { pickLabel } from '@sardpi/shared';
import { cn } from '@/lib/utils';
import { Badge, Button, Card, Field, Textarea } from '@/components/ui';
import { Dialog } from '@/components/dialogs';
import { useToast } from '@/components/toast';
import { useAuth } from '@/stores/auth';
import { applyActiveThemeCss } from '@/lib/theme-css';

interface ThemeEntry {
  /**
   * Manifeste validé (schéma `themeManifestZ`) : le nom d'affichage multilingue est `displayName`
   * et les couleurs vivent dans `variables.light|dark` sous forme de triplets RGB (« 14 165 183 »)
   * — les lire sous d'autres clés laissait les cartes muettes (nom de dossier seul, aucune pastille).
   */
  manifest: {
    name: string;
    displayName?: Record<string, string>;
    version?: string;
    author?: string;
    modes?: string[];
    accent?: string;
    variables?: Partial<Record<'light' | 'dark', Record<string, string>>>;
  };
  css: string;
  js: string | null;
  sha256: string;
  dir: string;
}
interface Scan {
  themes: ThemeEntry[];
  issues: { dir: string; error: string }[];
  scannedAt: string;
  /** nom du thème actif (settings.ui.theme) — '' si aucun réglage enregistré */
  active?: string;
}

/** Triplets RGB du manifeste (« 14 165 183 », « 255 255 255 / 0.62 ») → couleur CSS affichable. */
function swatches(entry: ThemeEntry): { key: string; color: string }[] {
  const vars = entry.manifest.variables?.light ?? {};
  const out: { key: string; color: string }[] = [];
  if (entry.manifest.accent) out.push({ key: 'accent', color: entry.manifest.accent });
  for (const [key, value] of Object.entries(vars)) {
    const v = String(value).trim();
    if (/^[\d.\s]+(\/[\d.]+)?$/.test(v)) out.push({ key, color: `rgb(${v})` });
    else if (v.startsWith('#')) out.push({ key, color: v });
    if (out.length >= 9) break;
  }
  return out;
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

  const activeName = q.data?.active ?? '';

  const activate = useMutation({
    mutationFn: (name: string) => api.post('/admin/themes/activate', { name }),
    onSuccess: async () => {
      toast.success(tc('saved'));
      // application immédiate (variables CSS + styles.css) — helper partagé avec Paramètres » Interface
      await applyActiveThemeCss();
      void qc.invalidateQueries({ queryKey: ['themes-scan'] });
      void qc.invalidateQueries({ queryKey: ['themes-names'] });
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
          const isActive = activeName === th.manifest.name;
          const colors = swatches(th);
          return (
            <Card key={th.dir} className={cn('flex flex-col gap-2', isActive && 'ring-1 ring-[rgb(var(--c-primary)/0.45)]')}>
              <div className="flex items-center gap-2">
                <b className="text-[14px]">{pickLabel(th.manifest.displayName ?? {}, lang) || th.manifest.name}</b>
                {isActive ? <Badge tone="ok"><CheckCircle2 size={11} /> {t('themes.active')}</Badge> : null}
                <Badge tone="neutral" className="ms-auto font-mono">{th.manifest.name}</Badge>
              </div>
              <div className="flex flex-wrap gap-1">
                {colors.map(({ key, color }) => (
                  <span key={key} title={key} className="h-5 w-5 rounded-full border border-black/10" style={{ background: color }} />
                ))}
              </div>
              {!colors.length && th.css ? (
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
                    {has('theme', 'update') ? (
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
                {/* `theme` est le module RBAC déclaré (MODULES) — « themes » ne correspondait à
                    aucune permission et masquait les boutons à tout rôle autre qu'administrateur. */}
                {has('theme', 'update') && !isActive ? (
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
