'use client';
/**
 * Paramètres — sections typées (schémas Zod côté serveur, rejet propre si invalide) :
 * général, interface (thème/densité/nav/animations), codification avec APERÇU EN DIRECT,
 * types de GED/praticiens, langues, étapes du circuit de soins, SMTP, captcha, sécurité,
 * sauvegardes, licence. Les sections complexes restent éditables en JSON validé.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Save } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Badge, Button, Card, Field, Input, Select, Switch, Tabs, Textarea } from '@/components/ui';
import { useToast } from '@/components/toast';

const SECTIONS = ['general', 'ui', 'codification', 'gedTypes', 'practitionerTypes', 'languages', 'workflowSteps', 'smtp', 'captcha', 'security', 'backups', 'license', 'vaccination'] as const;
type Section = (typeof SECTIONS)[number];

export default function SettingsPage(): React.ReactElement {
  const { t } = useT('settings');
  const [section, setSection] = useState<Section>('general');
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-3">
      <div>
        <h1 className="text-[20px] font-bold">{t('admin.settings')}</h1>
        <p className="text-[12.5px] text-[rgb(var(--c-muted))]">{t('settings.subtitle')}</p>
      </div>
      <Tabs
        active={section}
        onChange={(k) => setSection(k as Section)}
        tabs={SECTIONS.map((s) => ({ key: s, label: t(`settings.sections.${s}`) }))}
        className="flex-wrap"
      />
      <SectionEditor section={section} />
    </div>
  );
}

function SectionEditor({ section }: { section: Section }): React.ReactElement {
  const { t } = useT('settings');
  const { t: tc } = useT('common');
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings', section], queryFn: () => api.get<Record<string, unknown>>(`/admin/settings/${section}`) });
  const [mode, setMode] = useState<'form' | 'json'>('form');
  const [json, setJson] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (q.data) {
      setData(q.data);
      setJson(JSON.stringify(q.data, null, 2));
      setErr(null);
      setMode(['gedTypes', 'practitionerTypes', 'workflowSteps', 'vaccination', 'security', 'license', 'captcha'].includes(section) ? 'json' : 'form');
    }
  }, [q.data, section]);

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.put<Record<string, unknown>>(`/admin/settings/${section}`, payload),
    onSuccess: () => {
      toast.success(tc('saved'));
      void qc.invalidateQueries({ queryKey: ['settings', section] });
      void qc.invalidateQueries({ queryKey: ['perm-matrix'] });
    },
    onError: (e: unknown) => {
      const x = e as { details?: Record<string, string>; code?: string };
      setErr(x.details ? JSON.stringify(x.details) : `errors.${x.code ?? 'validation'}`);
      toast.error(tc('settings.invalidJson'));
    },
  });

  const submitJson = (): void => {
    try {
      const parsed = JSON.parse(json) as Record<string, unknown>;
      save.mutate(parsed);
    } catch {
      setErr(tc('settings.invalidJson'));
    }
  };

  if (q.isLoading) return <Card><div className="skeleton h-40" /></Card>;

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-bold">{t(`settings.sections.${section}`)}</h2>
        <div className="ms-auto flex items-center gap-1.5">
          <Button size="sm" variant={mode === 'form' ? 'primary' : 'ghost'} onClick={() => setMode('form')}>
            {t('settings.form')}
          </Button>
          <Button size="sm" variant={mode === 'json' ? 'primary' : 'ghost'} onClick={() => setMode('json')}>
            JSON
          </Button>
        </div>
      </div>

      {err ? <p className="rounded-xl bg-[rgb(var(--c-coral-soft))] px-3 py-2 font-mono text-[11.5px] font-bold text-[rgb(var(--c-coral))]">{err}</p> : null}

      {mode === 'json' ? (
        <div className="flex flex-col gap-2">
          <Textarea rows={18} value={json} onChange={(e) => setJson(e.target.value)} className="font-mono !text-[12px]" />
          <div className="flex justify-end">
            <Button variant="primary" loading={save.isPending} onClick={submitJson}>
              <Save size={14} /> {tc('save')}
            </Button>
          </div>
        </div>
      ) : (
        <FormEditor
          section={section}
          data={data}
          onChange={setData}
          onSave={() => save.mutate(data)}
          saving={save.isPending}
        />
      )}
    </Card>
  );
}

function FormEditor({ section, data, onChange, onSave, saving }: { section: Section; data: Record<string, unknown>; onChange: (d: Record<string, unknown>) => void; onSave: () => void; saving: boolean }): React.ReactElement {
  const { t } = useT('settings');
  const { t: tc } = useT('common');
  const set = (k: string, v: unknown): void => onChange({ ...data, [k]: v });
  const n = (k: string, d = 0): number => (typeof data[k] === 'number' ? (data[k] as number) : d);
  const s = (k: string): string => String(data[k] ?? '');

  const preview = useMemo(() => {
    if (section !== 'codification') return null;
    const sep = s('separator') || '-';
    const pad = (x: number) => String(x).padStart(n('patientPadding', 5), '0');
    return [
      `PAT${sep}${pad(1)}`,
      `MED${sep}${String(7).padStart(n('practitionerPadding', 5), '0')}`,
      `LOC${sep}${String(3).padStart(n('locationPadding', 3), '0')}`,
      `ANL${sep}${String(42).padStart(n('gedPadding', 6), '0')}`,
      `LAB${sep}${s('datePattern') === 'DDMMYYYY' ? '31122026' : '20261231'}${sep}${String(5).padStart(n('recordSeqPadding', 2), '0')}${sep}PAT${sep}00001`,
    ];
  }, [section, data]);

  switch (section) {
    case 'general':
      return (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('settings.appName')}><Input value={s('appName')} onChange={(e) => set('appName', e.target.value)} /></Field>
          <Field label={t('settings.country')}><Input value={s('country')} maxLength={2} title="Profil /country-profiles/*.json" onChange={(e) => set('country', e.target.value.toUpperCase())} /></Field>
          <Field label={t('settings.orgName')} className="col-span-2"><Input value={s('orgName')} onChange={(e) => set('orgName', e.target.value)} /></Field>
          <Field label={t('settings.orgAddress')} className="col-span-2"><Input value={s('orgAddress')} onChange={(e) => set('orgAddress', e.target.value)} /></Field>
          <Field label={t('settings.orgPhone')}><Input value={s('orgPhone')} onChange={(e) => set('orgPhone', e.target.value)} /></Field>
          <Field label={t('settings.orgEmail')}><Input value={s('orgEmail')} onChange={(e) => set('orgEmail', e.target.value)} /></Field>
          <Field label={t('settings.legal')} className="col-span-2"><Textarea rows={2} value={s('legalNotice')} onChange={(e) => set('legalNotice', e.target.value)} /></Field>
          <Field label={t('settings.footer')} className="col-span-2"><Input value={s('footerNote')} onChange={(e) => set('footerNote', e.target.value)} /></Field>
          <SaveBar onSave={onSave} saving={saving} />
        </div>
      );
    case 'ui':
      return (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('settings.theme')}><Input value={s('theme')} title="medical-blue · clinical-green · /themes/" onChange={(e) => set('theme', e.target.value)} /></Field>
          <Field label={t('settings.density')}>
            <Select value={s('density')} onChange={(e) => set('density', e.target.value)} options={[{ value: 'comfortable', label: t('settings.comfortable') }, { value: 'compact', label: t('settings.compact') }]} />
          </Field>
          <Field label={t('settings.nav')}>
            <Select value={s('nav')} onChange={(e) => set('nav', e.target.value)} options={[{ value: 'sidebar', label: 'sidebar' }, { value: 'topbar', label: 'topbar' }]} />
          </Field>
          <Field label={t('settings.animations')}>
            <Select value={s('animations')} onChange={(e) => set('animations', e.target.value)} options={[{ value: 'full', label: 'full' }, { value: 'reduced', label: 'reduced' }, { value: 'off', label: 'off' }]} />
          </Field>
          <Row label={t('settings.parallax')} on={Boolean(data.parallax)} onChange={(v) => set('parallax', v)} />
          <Row label={t('settings.arabicDigits')} on={Boolean(data.arabicDigits)} onChange={(v) => set('arabicDigits', v)} />
          <Row label={t('settings.hijri')} on={Boolean(data.hijriEnabled)} onChange={(v) => set('hijriEnabled', v)} />
          <SaveBar onSave={onSave} saving={saving} />
        </div>
      );
    case 'codification':
      return (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('settings.patientPrefix')}><Input value={s('patientPrefix')} onChange={(e) => set('patientPrefix', e.target.value.toUpperCase())} /></Field>
          <Field label={t('settings.patientPadding')}><Input type="number" min={3} max={8} value={n('patientPadding', 5)} onChange={(e) => set('patientPadding', Number(e.target.value))} /></Field>
          <Field label={t('settings.separator')}>
            <Select value={s('separator') || '-'} onChange={(e) => set('separator', e.target.value)} options={[{ value: '-', label: '-' }, { value: '.', label: '.' }, { value: '_', label: '_' }]} />
          </Field>
          <Field label={t('settings.datePattern')}>
            <Select value={s('datePattern') || 'YYYYMMDD'} onChange={(e) => set('datePattern', e.target.value)} options={['YYYYMMDD', 'YYMMDD', 'DDMMYYYY'].map((x) => ({ value: x, label: x }))} />
          </Field>
          <Field label={t('settings.practitionerPadding')}><Input type="number" min={3} max={8} value={n('practitionerPadding', 5)} onChange={(e) => set('practitionerPadding', Number(e.target.value))} /></Field>
          <Field label={t('settings.gedPadding')}><Input type="number" min={4} max={8} value={n('gedPadding', 6)} onChange={(e) => set('gedPadding', Number(e.target.value))} /></Field>
          <Field label={t('settings.locationPadding')}><Input type="number" min={2} max={6} value={n('locationPadding', 3)} onChange={(e) => set('locationPadding', Number(e.target.value))} /></Field>
          <Field label={t('settings.recordSeqPadding')}><Input type="number" min={2} max={3} value={n('recordSeqPadding', 2)} onChange={(e) => set('recordSeqPadding', Number(e.target.value))} /></Field>
          <Field label={t('settings.genericPadding')}><Input type="number" min={3} max={8} value={n('genericPadding', 5)} onChange={(e) => set('genericPadding', Number(e.target.value))} /></Field>
          <div className="col-span-2">
            <div className="mb-1 flex items-center gap-1.5 text-[12px] font-bold uppercase text-[rgb(var(--c-muted))]">
              <Eye size={12} /> {t('settings.preview')}
            </div>
            <div className="flex flex-wrap gap-2">
              {preview?.map((p) => (
                <span key={p} dir="ltr" className="rounded-lg border border-[rgb(var(--c-primary)/0.4)] bg-[rgb(var(--c-primary-soft))] px-2.5 py-1 font-mono text-[13px] font-bold">{p}</span>
              ))}
            </div>
            <p className="mt-1 text-[11.5px] text-[rgb(var(--c-muted))]">{t('settings.previewHint')}</p>
          </div>
          <SaveBar onSave={onSave} saving={saving} />
        </div>
      );
    case 'languages':
      return (
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('settings.defaultLang')}><Select value={s('default')} onChange={(e) => set('default', e.target.value)} options={['fr', 'ar', 'es', 'en'].map((x) => ({ value: x, label: x }))} /></Field>
          <Field label={t('settings.fallbackLang')}><Select value={s('fallback')} onChange={(e) => set('fallback', e.target.value)} options={['fr', 'ar', 'es', 'en'].map((x) => ({ value: x, label: x }))} /></Field>
          <div className="col-span-1">
            <span className="mb-1 block text-[12.5px] font-semibold">{t('settings.enabledLangs')}</span>
            {['fr', 'ar', 'es', 'en'].map((l) => (
              <div key={l} className="flex items-center justify-between py-0.5">
                <Badge tone={(data.enabled as string[] | undefined)?.includes(l) ? 'ok' : 'neutral'}>{l}</Badge>
                <Switch
                  checked={(data.enabled as string[] | undefined)?.includes(l) ?? false}
                  onChange={(on) => {
                    const cur = new Set((data.enabled as string[] | undefined) ?? []);
                    if (on) cur.add(l);
                    else cur.delete(l);
                    set('enabled', [...cur]);
                  }}
                />
              </div>
            ))}
          </div>
          <SaveBar onSave={onSave} saving={saving} />
        </div>
      );
    case 'smtp':
      return (
        <div className="grid grid-cols-2 gap-3">
          <Row label="SMTP activé" on={Boolean(data.enabled)} onChange={(v) => set('enabled', v)} />
          <Field label="Host"><Input value={s('host')} onChange={(e) => set('host', e.target.value)} /></Field>
          <Field label="Port"><Input type="number" value={n('port', 587)} onChange={(e) => set('port', Number(e.target.value))} /></Field>
          <Field label="Utilisateur"><Input value={s('user')} onChange={(e) => set('user', e.target.value)} /></Field>
          <Field label="Mot de passe" hint={tc('settings.secretKeep')}><Input type="password" value={s('password')} onChange={(e) => set('password', e.target.value)} /></Field>
          <Field label="From"><Input value={s('from')} onChange={(e) => set('from', e.target.value)} /></Field>
          <SaveBar onSave={onSave} saving={saving} />
        </div>
      );
    default:
      return (
        <div className="flex items-center justify-between">
          <p className="text-[12.5px] text-[rgb(var(--c-muted))]">{t('settings.useJson')}</p>
          <SaveBar onSave={onSave} saving={saving} />
        </div>
      );
  }
}

function Row({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }): React.ReactElement {
  return (
    <div className="flex min-h-[var(--row-h)] items-center justify-between rounded-xl border border-[rgb(var(--c-line)/0.6)] px-3">
      <span className="text-[13px] font-semibold">{label}</span>
      <Switch checked={on} onChange={onChange} />
    </div>
  );
}

function SaveBar({ onSave, saving }: { onSave: () => void; saving: boolean }): React.ReactElement {
  const { t: tc } = useT('common');
  return (
    <div className="col-span-2 flex justify-end border-t border-[rgb(var(--c-line)/0.6)] pt-3">
      <Button variant="primary" loading={saving} onClick={onSave}>
        <Save size={14} /> {tc('save')}
      </Button>
    </div>
  );
}
