'use client';
/**
 * Paramètres — sections typées (schémas Zod côté serveur, rejet propre si invalide) :
 * général, interface (thème/densité/nav/animations), codification avec APERÇU EN DIRECT,
 * types de GED/praticiens, langues, étapes du circuit de soins, SMTP, captcha, sécurité,
 * sauvegardes, licence. Les sections complexes restent éditables en JSON validé.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Hash, Pencil, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Badge, Button, Card, Field, Input, Select, Switch, Tabs, Textarea } from '@/components/ui';
import { Drawer } from '@/components/dialogs';
import { useToast } from '@/components/toast';

const SECTIONS = ['general', 'ui', 'codification', 'medicalRefs', 'gedTypes', 'practitionerTypes', 'languages', 'workflowSteps', 'smtp', 'captcha', 'security', 'backups', 'license', 'vaccination'] as const;
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
      // formats d'affichage & libellés de préfixes recalculés immédiatement (lists, infobulles)
      void qc.invalidateQueries({ queryKey: ['refs', 'display'] });
      void qc.invalidateQueries({ queryKey: ['refs', 'prefixes'] });
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
          <Field label={t('settings.dateDisplay')}>
            <Select value={s('dateDisplay')} onChange={(e) => set('dateDisplay', e.target.value)} options={[{ value: 'DD/MM/YYYY', label: '31/12/2026' }, { value: 'DD-MM-YYYY', label: '31-12-2026' }, { value: 'MM/DD/YYYY', label: '12/31/2026' }, { value: 'YYYY-MM-DD', label: '2026-12-31' }]} />
          </Field>
          <Row label={t('settings.timeDisplay')} on={Boolean(data.timeDisplay)} onChange={(v) => set('timeDisplay', v)} />
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
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3">
            <Field label={t('settings.patientPrefix')}><Input value={s('patientPrefix')} onChange={(e) => set('patientPrefix', e.target.value.toUpperCase())} className="font-mono" /></Field>
            <Field label={t('settings.separator')}>
              <Select value={s('separator') || '-'} onChange={(e) => set('separator', e.target.value)} options={[{ value: '-', label: '-' }, { value: '.', label: '.' }, { value: '_', label: '_' }]} />
            </Field>
            <Field label={t('settings.datePattern')}>
              <Select value={s('datePattern') || 'YYYYMMDD'} onChange={(e) => set('datePattern', e.target.value)} options={['YYYYMMDD', 'YYMMDD', 'DDMMYYYY'].map((x) => ({ value: x, label: x }))} />
            </Field>
          </div>
          {/* CRUD des types de code : préfixe / padding / séparateur / prochain code / compteur — éditable, sans suppression */}
          <CodificationCrud data={data} set={set} />
          <div>
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
    case 'medicalRefs': {
      const rows = (k: string): { code: string; label: Record<string, string>; active?: boolean }[] =>
        Array.isArray(data[k]) ? (data[k] as { code: string; label: Record<string, string>; active?: boolean }[]) : [];
      return (
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-[rgb(var(--c-muted))]">{t('settings.medicalRefs.hint')}</p>
          <RefCrudTable title={t('settings.medicalRefs.blood')} items={rows('bloodGroups')} onChange={(v) => set('bloodGroups', v)} />
          <RefCrudTable title={t('settings.medicalRefs.funds')} items={rows('ssFunds')} onChange={(v) => set('ssFunds', v)} />
          <SaveBar onSave={onSave} saving={saving} />
        </div>
      );
    }
    default:
      return (
        <div className="flex items-center justify-between">
          <p className="text-[13.5px] text-[rgb(var(--c-muted))]">{t('settings.useJson')}</p>
          <SaveBar onSave={onSave} saving={saving} />
        </div>
      );
  }
}

/** Liste CRUD de référence (groupes sanguins, caisses SS) : table + tiroir créer/éditer, activation, suppression. */
interface RefItem { code: string; label: Record<string, string>; active?: boolean }
function RefCrudTable({ title, items, onChange }: { title: string; items: RefItem[]; onChange: (v: RefItem[]) => void }): React.ReactElement {
  const { t: tc } = useT('common');
  const { t } = useT('settings');
  const [drawer, setDrawer] = useState<{ mode: 'new' | 'edit'; index?: number } | null>(null);
  const [form, setForm] = useState<RefItem>({ code: '', label: { fr: '', ar: '', es: '', en: '' }, active: true });
  const openNew = (): void => {
    setForm({ code: '', label: { fr: '', ar: '', es: '', en: '' }, active: true });
    setDrawer({ mode: 'new' });
  };
  const openEdit = (i: number): void => {
    const it = items[i]!;
    setForm({ code: it.code, label: { fr: '', ar: '', es: '', en: '', ...(it.label ?? {}) }, active: it.active !== false });
    setDrawer({ mode: 'edit', index: i });
  };
  const commit = (): void => {
    const code = form.code.trim().toUpperCase();
    if (!code) return;
    const entry: RefItem = { code, label: form.label ?? {}, active: form.active !== false };
    if (drawer?.mode === 'new') onChange([...items, entry]);
    else if (drawer?.mode === 'edit' && drawer.index != null) onChange(items.map((x, j) => (j === drawer.index ? entry : x)));
    setDrawer(null);
  };
  const toggle = (i: number): void => onChange(items.map((x, j) => (j === i ? { ...x, active: x.active === false } : x)));
  const remove = (i: number): void => onChange(items.filter((_, j) => j !== i));
  return (
    <Card className="flex flex-col gap-2 !p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[14px] font-bold">{title}</h3>
        <Button size="sm" variant="primary" onClick={openNew}><Plus size={13} /> {tc('new')}</Button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-[rgb(var(--c-line))]">
        <table className="dt-table">
          <thead>
            <tr><th>{tc('code')}</th><th>FR</th><th>ع</th><th>ES</th><th>EN</th><th>{tc('active')}</th><th /></tr>
          </thead>
          <tbody>
            {items.map((x, i) => (
              <tr key={`${x.code}-${i}`}>
                <td dir="ltr" className="font-mono text-[12.5px] font-bold">{x.code}</td>
                <td className="text-[12.5px]">{x.label?.fr}</td>
                <td dir="rtl" className="text-[12.5px]">{x.label?.ar}</td>
                <td className="text-[12.5px]">{x.label?.es}</td>
                <td className="text-[12.5px]">{x.label?.en}</td>
                <td>{x.active === false ? <Badge>—</Badge> : <Badge tone="ok">✓</Badge>}</td>
                <td>
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" className="btn-icon !min-h-7 !min-w-7" title={tc('edit')} onClick={() => openEdit(i)}><Pencil size={13} /></Button>
                    <Button size="sm" variant="ghost" className="btn-icon !min-h-7 !min-w-7" title={x.active === false ? t('settings.ref.enable') : t('settings.ref.disable')} onClick={() => toggle(i)}>{x.active === false ? '↺' : '⏻'}</Button>
                    <Button size="sm" variant="ghost" className="btn-icon !min-h-7 !min-w-7" title={tc('delete')} onClick={() => remove(i)}><Trash2 size={13} /></Button>
                  </div>
                </td>
              </tr>
            ))}
            {!items.length ? <tr><td colSpan={7} className="py-3 text-center text-[13px] text-[rgb(var(--c-muted))]">—</td></tr> : null}
          </tbody>
        </table>
      </div>
      <Drawer
        open={Boolean(drawer)}
        onClose={() => setDrawer(null)}
        title={drawer?.mode === 'edit' ? `${tc('edit')} — ${title}` : `${tc('new')} — ${title}`}
        footer={<><Button onClick={() => setDrawer(null)}>{tc('cancel')}</Button><Button variant="primary" disabled={!form.code.trim()} onClick={commit}>{tc('save')}</Button></>}
      >
        <div className="flex flex-col gap-3">
          <Field label={tc('code')} required><Input className="font-mono" value={form.code} placeholder="A+ / CNAS" onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} /></Field>
          {(['fr', 'ar', 'es', 'en'] as const).map((lg) => (
            <Field key={lg} label={lg.toUpperCase()}><Input dir={lg === 'ar' ? 'rtl' : undefined} value={form.label?.[lg] ?? ''} onChange={(e) => setForm({ ...form, label: { ...form.label, [lg]: e.target.value } })} /></Field>
          ))}
          <Row label={tc('active')} on={form.active !== false} onChange={(v) => setForm({ ...form, active: v })} />
        </div>
      </Drawer>
    </Card>
  );
}

/** CRUD codification — une ligne par type de code (préfixe, padding, séparateur, prochain code, compteur). */
interface CodRow { kind: string; prefix: string; prefixField: string | null; padding: number; paddingField: string; separator: string; datePattern: string | null; currentSeq: number; nextPreview: string }
function CodificationCrud({ data, set }: { data: Record<string, unknown>; set: (k: string, v: unknown) => void }): React.ReactElement {
  const { t } = useT('settings');
  const q = useQuery({ queryKey: ['codification-rows'], queryFn: () => api.get<{ rows: CodRow[] }>('/admin/codification/rows') });
  const rows = q.data?.rows ?? [];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[12px] font-bold uppercase text-[rgb(var(--c-muted))]"><Hash size={13} /> {t('settings.codification.table')}</h3>
        <Button size="sm" variant="ghost" onClick={() => void q.refetch()}><RefreshCw size={13} /> {t('settings.codification.refresh')}</Button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-[rgb(var(--c-line))]">
        <table className="dt-table">
          <thead>
            <tr>
              <th>{t('settings.codification.kind')}</th>
              <th>{t('settings.codification.prefix')}</th>
              <th>{t('settings.codification.padding')}</th>
              <th>{t('settings.codification.separator')}</th>
              <th className="text-center">{t('settings.codification.currentSeq')}</th>
              <th>{t('settings.codification.nextPreview')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.kind}>
                <td className="text-[12.5px] font-semibold">{t(`settings.codKind.${r.kind}`)}</td>
                <td>
                  {r.prefixField ? (
                    <Input className="!min-h-8 w-24 !text-[13px] font-mono" value={String(data[r.prefixField] ?? r.prefix)} onChange={(e) => set(r.prefixField as string, e.target.value.toUpperCase())} />
                  ) : (
                    <span dir="ltr" className="font-mono text-[12px] text-[rgb(var(--c-muted))]">{r.prefix}</span>
                  )}
                </td>
                <td><Input type="number" min={2} max={8} className="!min-h-8 w-20 !text-[13px]" value={Number(data[r.paddingField] ?? r.padding)} onChange={(e) => set(r.paddingField, Number(e.target.value))} /></td>
                <td className="text-center font-mono text-[13px]">{r.separator}</td>
                <td className="text-center font-mono text-[13px] tabular-nums">{r.currentSeq}</td>
                <td><span dir="ltr" className="rounded-lg border border-[rgb(var(--c-primary)/0.4)] bg-[rgb(var(--c-primary-soft))] px-2 py-0.5 font-mono text-[12px] font-bold">{r.nextPreview}</span></td>
              </tr>
            ))}
            {!rows.length ? <tr><td colSpan={6} className="py-3 text-center text-[13px] text-[rgb(var(--c-muted))]">…</td></tr> : null}
          </tbody>
        </table>
      </div>
      <p className="text-[11.5px] text-[rgb(var(--c-muted))]">{t('settings.codification.hint')}</p>
    </div>
  );
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
