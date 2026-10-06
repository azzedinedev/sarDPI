'use client';
/**
 * Paramètres — sections typées (schémas Zod côté serveur, rejet propre si invalide) :
 * général, interface (thème/densité/nav/animations), codification avec APERÇU EN DIRECT,
 * types de GED/praticiens, langues, étapes du circuit de soins, SMTP, captcha, sécurité,
 * sauvegardes, licence. Les sections complexes restent éditables en JSON validé.
 *
 * MISE EN PAGE (PC / tablette / mobile) :
 *  - PLEINE LARGEUR : plus de colonne `max-w-4xl` centrée qui laissait de grandes marges vides ;
 *    les formulaires se déploient en 2 → 4 colonnes selon le palier (sm / xl), les tableaux
 *    (codification, référentiels) profitent de toute la largeur.
 *  - SOUS-MENU COLLANT : colonne verticale groupée + filtre au-delà de `lg`, bandeau de pastilles
 *    défilables en dessous (une main, au pouce). Il se colle SOUS la topbar grâce à
 *    `--app-sticky-top`, publiée par le Shell (aucune hauteur codée en dur) ; la colonne défile
 *    pour elle-même (nav-scroll-y) sans jamais emporter la page.
 *  - BARRE D'ENREGISTREMENT COLLANTE : état « à jour / modifications non enregistrées », retour à
 *    la version serveur, et garde-fou au changement de section — on ne perd plus une saisie en
 *    cliquant ailleurs. Le mode JSON partage la même barre (un seul chemin d'enregistrement).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Hash, Pencil, Plus, RefreshCw, RotateCcw, Save, Search, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Badge, Button, Card, Field, Input, Select, Switch, Textarea } from '@/components/ui';
import { Dialog, Drawer } from '@/components/dialogs';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/utils';
import { FORM_SECTIONS, SETTINGS_SECTIONS, filterSections, groupSections, nextSection, sectionDirty, type SettingsSection as Section } from '@/lib/settings-sections';
import { SECTION_FORMS, issuesByPath, issuesVarsByPath, sectionSchema, validateJsonText } from '@/lib/settings-fields';
import { SettingsForm, hasFormSpec } from '@/components/settings-form';


export default function SettingsPage(): React.ReactElement {
  const { t } = useT('settings');
  const [section, setSection] = useState<Section>('general');
  const [dirty, setDirty] = useState(false);
  /** section demandée alors qu'une saisie n'était pas enregistrée (garde-fou) */
  const [pending, setPending] = useState<Section | null>(null);

  const labelOf = useCallback((k: Section): string => t(`settings.sections.${k}`), [t]);
  const onDirtyChange = useCallback((d: boolean) => setDirty(d), []);

  const goto = useCallback(
    (next: Section) => {
      if (next === section) return;
      if (dirty) {
        setPending(next);
        return;
      }
      setSection(next);
    },
    [dirty, section],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-[20px] font-bold">{t('admin.settings')}</h1>
          <p className="text-[12.5px] text-[rgb(var(--c-muted))]">{t('settings.subtitle')}</p>
        </div>
        {dirty && pending === null ? <Badge tone="warn">{t('settings.save.dirty')}</Badge> : null}
      </div>

      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:gap-4">
        <SettingsNav active={section} dirty={dirty} onSelect={goto} />
        <div className="min-w-0 flex-1">
          {/* clé = la section : changer de section réinitialise proprement formulaire, JSON et erreurs */}
          <SectionEditor key={section} section={section} onDirtyChange={onDirtyChange} />
        </div>
      </div>

      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={t('settings.save.leaveTitle')}
        footer={
          <>
            <Button onClick={() => setPending(null)}>{t('settings.save.stay')}</Button>
            <Button
              variant="primary"
              onClick={() => {
                if (pending) setSection(pending);
                setPending(null);
                setDirty(false);
              }}
            >
              {t('settings.save.leaveGo')}
            </Button>
          </>
        }
      >
        <p className="text-[13.5px]">{t('settings.save.leaveHint', { section: labelOf(section) })}</p>
      </Dialog>
    </div>
  );
}

/**
 * Sous-menu des sections.
 *  - `lg` et plus : colonne collante, groupée, avec filtre — elle défile seule (nav-scroll-y).
 *  - en dessous : bandeau collant de pastilles défilables horizontalement, pastille active recentrée.
 * Les deux partagent le même état (aucun doublon de logique) ; la navigation clavier (flèches,
 * Début/Fin) suit le standard `tablist` vertical.
 */
function SettingsNav({ active, dirty, onSelect }: { active: Section; dirty: boolean; onSelect: (s: Section) => void }): React.ReactElement {
  const { t } = useT('settings');
  const [filter, setFilter] = useState('');
  const chipsRef = useRef<HTMLDivElement | null>(null);

  const items = useMemo(() => SETTINGS_SECTIONS.map((s) => ({ key: s.key as Section, icon: s.icon, group: s.group, label: t(`settings.sections.${s.key}`) })), [t]);
  const matches = useMemo(() => filterSections(items, filter), [items, filter]);
  const grouped = useMemo(() => groupSections(matches), [matches]);

  // recentre la pastille active dans le bandeau horizontal (sans faire défiler la page verticalement)
  useEffect(() => {
    const el = chipsRef.current?.querySelector<HTMLElement>(`[data-sec="${active}"]`);
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent, item: Section): void => {
    const arrows = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'] as const;
    if (!arrows.includes(e.key as (typeof arrows)[number])) return;
    const next = nextSection(matches.map((x) => x.key), item, e.key as (typeof arrows)[number]);
    if (!next) return;
    e.preventDefault();
    onSelect(next as Section);
    requestAnimationFrame(() => document.getElementById(`settings-tab-${next}`)?.focus());
  };

  return (
    <>
      {/* ------------------------------------------------- mobile / tablette : bandeau de pastilles */}
      <div className="sticky-under-topbar z-20 lg:hidden">
        <div className="glass-soft -mx-2 flex flex-col gap-1.5 rounded-none border-x-0 px-2 py-1.5 md:-mx-3.5 md:px-3.5">
          <div className="flex items-center gap-2">
            <span className="text-[10.5px] font-bold uppercase tracking-widest text-[rgb(var(--c-muted))]">{t('settings.nav.sections')}</span>
            <span className="ms-auto truncate text-[12px] font-bold text-[rgb(var(--c-primary))]">{t(`settings.sections.${active}`)}</span>
          </div>
          <div ref={chipsRef} className="nav-scroll-x -mb-0.5 flex gap-1.5 overflow-x-auto pb-1">
            {items.map((x) => (
              <button
                key={x.key}
                type="button"
                data-sec={x.key}
                aria-current={active === x.key ? 'true' : undefined}
                onClick={() => onSelect(x.key)}
                className={cn(
                  'flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold transition-colors',
                  active === x.key
                    ? 'border-transparent bg-[rgb(var(--c-primary))] text-[rgb(var(--c-primary-ink))] shadow'
                    : 'border-[rgb(var(--c-line)/0.8)] bg-[rgb(var(--c-surface)/0.7)] text-[rgb(var(--c-ink)/0.75)]',
                )}
              >
                <x.icon size={14} className="shrink-0" />
                {x.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* --------------------------------------------------------- desktop : colonne collante */}
      <nav
        aria-label={t('settings.nav.sections')}
        className="sticky-under-topbar hidden w-[250px] shrink-0 lg:block xl:w-[272px]"
      >
        <div className="glass-soft flex flex-col gap-2 p-2.5" style={{ maxHeight: 'calc(100dvh - var(--app-sticky-top, 7rem) - 1.5rem)' }}>
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-[rgb(var(--c-muted))] ltr:left-2.5 rtl:right-2.5" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('settings.nav.filter')}
              aria-label={t('settings.nav.filter')}
              className="field !min-h-9 !py-1 !text-[12.5px]"
              style={{ paddingInlineStart: '2.1rem' }}
            />
          </div>
          <div role="tablist" aria-orientation="vertical" className="nav-scroll-y flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pe-0.5">
            {grouped.map(({ group, items: list }) => (
              <div key={group} className="flex flex-col gap-0.5">
                <span className="px-2 pb-0.5 pt-2 text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--c-muted))]">{t(`settings.nav.groups.${group}`)}</span>
                {list.map((x) => (
                  <button
                    key={x.key}
                    id={`settings-tab-${x.key}`}
                    type="button"
                    role="tab"
                    aria-selected={active === x.key}
                    aria-controls="settings-panel"
                    tabIndex={active === x.key ? 0 : -1}
                    onClick={() => onSelect(x.key)}
                    onKeyDown={(e) => onKeyDown(e, x.key)}
                    className={cn(
                      'relative flex min-h-[var(--row-h)] items-center gap-2.5 rounded-xl px-2.5 text-start text-[13px] font-semibold transition-colors',
                      active === x.key ? 'bg-[rgb(var(--c-primary)/0.12)] text-[rgb(var(--c-primary))]' : 'text-[rgb(var(--c-ink)/0.75)] hover:bg-[rgb(var(--c-surface-2))]',
                    )}
                  >
                    {active === x.key ? <span className="absolute inset-y-1 w-[3px] rounded-full bg-[rgb(var(--c-primary))] ltr:left-0 rtl:right-0" /> : null}
                    <x.icon size={16} className="shrink-0" />
                    <span className="truncate">{x.label}</span>
                    {active === x.key && dirty ? <span title={t('settings.save.dirty')} className="ms-auto h-2 w-2 shrink-0 rounded-full bg-[rgb(var(--c-amber))]" /> : null}
                  </button>
                ))}
              </div>
            ))}
            {!grouped.length ? <p className="px-2 py-3 text-[12.5px] text-[rgb(var(--c-muted))]">{t('settings.nav.empty')}</p> : null}
          </div>
        </div>
      </nav>
    </>
  );
}

function SectionEditor({ section, onDirtyChange }: { section: Section; onDirtyChange: (d: boolean) => void }): React.ReactElement {
  const { t } = useT('settings');
  const { t: tc } = useT('common');
  const toast = useToast();
  const qc = useQueryClient();
  /** Sections pilotées par spécification (champs + listes CRUD) : la majorité des modules. */
  const hasSpec = hasFormSpec(section);
  /** Toutes les sections disposent désormais d'un formulaire ; le JSON reste l'édition avancée. */
  const hasForm = FORM_SECTIONS.has(section) || hasSpec;
  const q = useQuery({ queryKey: ['settings', section], queryFn: () => api.get<Record<string, unknown>>(`/admin/settings/${section}`) });
  const [mode, setMode] = useState<'form' | 'json'>('form');
  const [json, setJson] = useState('');
  const [err, setErr] = useState<string | null>(null);
  /** Erreurs renvoyées par le SERVEUR, par champ (« kinds.0.key » → message) : le serveur reste l'autorité. */
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [data, setData] = useState<Record<string, unknown>>({});
  /** dernière version connue du SERVEUR (sérialisée) : référence de l'état « à jour » */
  const [baseline, setBaseline] = useState('');

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.put<{ value?: Record<string, unknown> }>(`/admin/settings/${section}`, payload),
    onSuccess: (res) => {
      toast.success(tc('saved'));
      // la réponse serveur (valeurs normalisées/par défaut appliqués) devient la nouvelle référence
      const next = res && typeof res === 'object' && res.value && typeof res.value === 'object' ? res.value : data;
      setData(next);
      setJson(JSON.stringify(next, null, 2));
      setBaseline(JSON.stringify(next));
      setErr(null);
      setServerErrors({});
      void qc.invalidateQueries({ queryKey: ['settings', section] });
      void qc.invalidateQueries({ queryKey: ['perm-matrix'] });
      // formats d'affichage & libellés de préfixes recalculés immédiatement (lists, infobulles)
      void qc.invalidateQueries({ queryKey: ['refs', 'display'] });
      void qc.invalidateQueries({ queryKey: ['refs', 'prefixes'] });
    },
    onError: (e: unknown) => {
      const x = e as { details?: Record<string, string> | null; code?: string; status?: number };
      // Le serveur revalide avec le même schéma : ses `details` portent les chemins de champ
      // (« kinds.0.key ») → affichés SOUS le champ concerné, comme les erreurs locales.
      if (x.details && typeof x.details === 'object') setServerErrors(x.details);
      setErr(x.details ? null : tc(`errors.${x.code ?? 'validation'}`));
      toast.error(tc('settings.invalidJson'));
    },
  });

  useEffect(() => {
    // Une réponse identique à la référence ne doit pas écraser une saisie en cours (rafraîchissement
    // de fenêtre, refetch en arrière-plan) ; une réponse différente (après enregistrement) fait foi.
    if (!q.data || save.isPending) return; // jamais pendant l'écriture : le serveur répondrait l'ancienne valeur
    const snap = JSON.stringify(q.data);
    if (snap === baseline) return;
    setBaseline(snap);
    setData(q.data);
    setJson(JSON.stringify(q.data, null, 2));
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  const submit = (): void => {
    if (mode === 'json') {
      const check = validateJsonText(section, json);
      if (!check.ok) {
        setErr(describeIssues(check.errors, check.vars ?? {}, t));
        return;
      }
      setErr(null);
      save.mutate(check.value as Record<string, unknown>);
      return;
    }
    // le formulaire est déjà validé en direct : on ne peut pas arriver ici avec des erreurs,
    // mais l'appel reste gardé (double sécurité, message explicite).
    if (invalidCount > 0) {
      setErr(describeIssues(fieldErrors, fieldVars, t));
      return;
    }
    setErr(null);
    save.mutate(data);
  };

  /**
   * Erreurs de champ calculées avec LE MÊME schéma que l'API : l'utilisateur voit ce qui bloque
   * avant l'appel réseau, et le serveur reste l'autorité (il revalide à l'enregistrement).
   */
  const localErrors = useMemo(() => (mode === 'form' ? issuesByPath(section, data) : {}), [mode, section, data]);
  /** Erreurs affichées : celles du navigateur, complétées par celles du serveur (mêmes chemins). */
  const fieldErrors = useMemo(() => ({ ...localErrors, ...serverErrors }), [localErrors, serverErrors]);
  const fieldVars = useMemo(() => (mode === 'form' ? issuesVarsByPath(section, data) : {}), [mode, section, data]);
  /** Une saisie corrigée efface l'erreur serveur correspondante (sinon elle resterait affichée à vie). */
  useEffect(() => {
    setServerErrors((prev) => {
      const keys = Object.keys(prev).filter((k) => k in localErrors);
      if (!keys.length) return prev;
      const next = { ...prev };
      for (const k of keys) delete next[k];
      return next;
    });
  }, [localErrors]);

  /** JSON avancé : validé contre le même schéma, erreurs listées (chemin + message). */
  const jsonCheck = useMemo(() => (mode === 'json' ? validateJsonText(section, json) : null), [mode, section, json]);
  const jsonErrors = jsonCheck && !jsonCheck.ok ? jsonCheck.errors : {};
  const jsonVars = jsonCheck && !jsonCheck.ok ? jsonCheck.vars : {};
  const invalidCount = mode === 'form' ? Object.keys(fieldErrors).length : Object.keys(jsonErrors).length;

  const dirty = useMemo(() => sectionDirty(mode, data, json, baseline), [mode, data, json, baseline]);

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const reset = (): void => {
    if (!q.data) return;
    setData(q.data);
    setJson(JSON.stringify(q.data, null, 2));
    setErr(null);
  };

  if (q.isLoading) {
    return (
      <Card className="flex flex-col gap-3">
        <div className="skeleton h-6 w-52" />
        <div className="skeleton h-40" />
      </Card>
    );
  }

  return (
    <Card role="tabpanel" id="settings-panel" aria-labelledby={`settings-tab-${section}`} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-bold">{t(`settings.sections.${section}`)}</h2>
        {hasForm ? (
          <div role="tablist" aria-label={t('settings.editMode')} className="ms-auto flex gap-0.5 rounded-xl border border-[rgb(var(--c-line)/0.7)] bg-[rgb(var(--c-surface)/0.6)] p-0.5">
            {(['form', 'json'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  'min-h-8 rounded-[9px] px-3 text-[12.5px] font-semibold transition-colors',
                  mode === m ? 'bg-[rgb(var(--c-primary))] text-[rgb(var(--c-primary-ink))] shadow' : 'text-[rgb(var(--c-muted))] hover:bg-[rgb(var(--c-surface-2))]',
                )}
              >
                {m === 'form' ? t('settings.form') : t('settings.jsonAdvanced')}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {err ? <p className="rounded-xl bg-[rgb(var(--c-coral-soft))] px-3 py-2 font-mono text-[11.5px] font-bold text-[rgb(var(--c-coral))]">{err}</p> : null}

      {mode === 'json' ? (
        <div className="flex flex-col gap-2">
          <p className="text-[12.5px] text-[rgb(var(--c-muted))]">{t('settings.jsonAdvancedHint')}</p>
          {Object.keys(jsonErrors).length ? (
            <ul className="rounded-xl bg-[rgb(var(--c-coral-soft))] px-3 py-2 font-mono text-[11.5px] font-bold text-[rgb(var(--c-coral))]">
              {Object.entries(jsonErrors).map(([path, code]) => (
                <li key={path}>
                  {path === '_' ? '' : `${path} : `}
                  {t(`settings.validation.${code}`, jsonVars[path] ?? {})}
                </li>
              ))}
            </ul>
          ) : null}
          <Textarea
            rows={Math.min(30, Math.max(16, json.split('\n').length + 1))}
            value={json}
            onChange={(e) => setJson(e.target.value)}
            spellCheck={false}
            dir="ltr"
            className="min-h-[46vh] font-mono !text-[12px] leading-relaxed"
          />
        </div>
      ) : hasSpec ? (
        <SettingsForm section={section} data={data} onChange={setData} errors={fieldErrors} />
      ) : (
        <FormEditor section={section} data={data} onChange={setData} />
      )}

      <SaveBar dirty={dirty} saving={save.isPending} invalidCount={invalidCount} onSave={submit} onReset={reset} />
    </Card>
  );
}

/** Intertitre de bloc de formulaire (regroupements lisibles sur grand écran). */
function Group({ title, hint, className, children }: { title?: string; hint?: string; className?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section className={cn('flex flex-col gap-3', className)}>
      {title ? <h3 className="text-[11.5px] font-bold uppercase tracking-widest text-[rgb(var(--c-muted))]">{title}</h3> : null}
      {hint ? <p className="-mt-1.5 text-[12px] text-[rgb(var(--c-muted))]">{hint}</p> : null}
      {children}
    </section>
  );
}

/** Grille de champs : 1 colonne (mobile) → 2 (tablette) → 3-4 (poste large, la page n'est plus bridée). */
function Grid({ cols = 2, className, children }: { cols?: 2 | 3 | 4; className?: string; children: React.ReactNode }): React.ReactElement {
  const sizes = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 xl:grid-cols-3', 4: 'sm:grid-cols-2 xl:grid-cols-4' } as const;
  return <div className={cn('grid gap-3', sizes[cols], className)}>{children}</div>;
}

function FormEditor({ section, data, onChange }: { section: Section; data: Record<string, unknown>; onChange: (d: Record<string, unknown>) => void }): React.ReactElement {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, data]);

  switch (section) {
    case 'general':
      return (
        <div className="flex flex-col gap-5">
          <Group title={t('settings.groups.identity')}>
            <Grid cols={3}>
              <Field label={t('settings.appName')}>
                <Input value={s('appName')} onChange={(e) => set('appName', e.target.value)} />
              </Field>
              <Field label={t('settings.country')}>
                <Input value={s('country')} maxLength={2} title="Profil /country-profiles/*.json" onChange={(e) => set('country', e.target.value.toUpperCase())} />
              </Field>
              <Field label={t('settings.orgName')} className="sm:col-span-2 xl:col-span-1">
                <Input value={s('orgName')} onChange={(e) => set('orgName', e.target.value)} />
              </Field>
            </Grid>
          </Group>

          <Group title={t('settings.groups.contact')}>
            <Grid cols={3}>
              <Field label={t('settings.orgAddress')}>
                <Input value={s('orgAddress')} onChange={(e) => set('orgAddress', e.target.value)} />
              </Field>
              <Field label={t('settings.orgPhone')}>
                <Input value={s('orgPhone')} onChange={(e) => set('orgPhone', e.target.value)} />
              </Field>
              <Field label={t('settings.orgEmail')}>
                <Input type="email" value={s('orgEmail')} onChange={(e) => set('orgEmail', e.target.value)} />
              </Field>
            </Grid>
          </Group>

          <Group title={t('settings.groups.display')}>
            <Grid cols={4}>
              <Field label={t('settings.dateDisplay')}>
                <Select
                  value={s('dateDisplay')}
                  onChange={(e) => set('dateDisplay', e.target.value)}
                  options={[
                    { value: 'DD/MM/YYYY', label: '31/12/2026' },
                    { value: 'DD-MM-YYYY', label: '31-12-2026' },
                    { value: 'MM/DD/YYYY', label: '12/31/2026' },
                    { value: 'YYYY-MM-DD', label: '2026-12-31' },
                  ]}
                />
              </Field>
              <Row label={t('settings.timeDisplay')} on={Boolean(data.timeDisplay)} onChange={(v) => set('timeDisplay', v)} />
              <Field label={t('settings.footer')} className="sm:col-span-2">
                <Input value={s('footerNote')} onChange={(e) => set('footerNote', e.target.value)} />
              </Field>
              <Field label={t('settings.legal')} className="xl:col-span-4">
                <Textarea rows={3} value={s('legalNotice')} onChange={(e) => set('legalNotice', e.target.value)} />
              </Field>
            </Grid>
          </Group>
        </div>
      );

    case 'ui':
      return (
        <div className="flex flex-col gap-5">
          <Group title={t('settings.groups.appearance')}>
            <Grid cols={4}>
              <Field label={t('settings.theme')}>
                <Input value={s('theme')} title="medical-blue · clinical-green · /themes/" onChange={(e) => set('theme', e.target.value)} />
              </Field>
              <Field label={t('settings.density')}>
                <Select
                  value={s('density')}
                  onChange={(e) => set('density', e.target.value)}
                  options={[
                    { value: 'comfortable', label: t('settings.comfortable') },
                    { value: 'compact', label: t('settings.compact') },
                  ]}
                />
              </Field>
              <Field label={t('settings.animations')}>
                <Select
                  value={s('animations')}
                  onChange={(e) => set('animations', e.target.value)}
                  options={[
                    { value: 'full', label: 'full' },
                    { value: 'reduced', label: 'reduced' },
                    { value: 'off', label: 'off' },
                  ]}
                />
              </Field>
              <Row label={t('settings.parallax')} on={Boolean(data.parallax)} onChange={(v) => set('parallax', v)} />
            </Grid>
          </Group>

          <Group title={t('settings.groups.behaviour')}>
            <Grid cols={4}>
              <Field label={t('settings.nav')}>
                <Select
                  value={s('nav')}
                  onChange={(e) => set('nav', e.target.value)}
                  options={[
                    { value: 'sidebar', label: 'sidebar' },
                    { value: 'topbar', label: 'topbar' },
                  ]}
                />
              </Field>
              <Row label={t('settings.arabicDigits')} on={Boolean(data.arabicDigits)} onChange={(v) => set('arabicDigits', v)} />
              <Row label={t('settings.hijri')} on={Boolean(data.hijriEnabled)} onChange={(v) => set('hijriEnabled', v)} />
            </Grid>
          </Group>
        </div>
      );

    case 'codification':
      return (
        <div className="flex flex-col gap-5">
          <Group title={t('settings.codification')}>
            <Grid cols={3}>
              <Field label={t('settings.patientPrefix')}>
                <Input value={s('patientPrefix')} onChange={(e) => set('patientPrefix', e.target.value.toUpperCase())} className="font-mono" />
              </Field>
              <Field label={t('settings.separator')}>
                <Select
                  value={s('separator') || '-'}
                  onChange={(e) => set('separator', e.target.value)}
                  options={[
                    { value: '-', label: '-' },
                    { value: '.', label: '.' },
                    { value: '_', label: '_' },
                  ]}
                />
              </Field>
              <Field label={t('settings.datePattern')}>
                <Select value={s('datePattern') || 'YYYYMMDD'} onChange={(e) => set('datePattern', e.target.value)} options={['YYYYMMDD', 'YYMMDD', 'DDMMYYYY'].map((x) => ({ value: x, label: x }))} />
              </Field>
            </Grid>
          </Group>
          {/* CRUD des types de code : préfixe / padding / séparateur / prochain code / compteur — éditable, sans suppression */}
          <CodificationCrud data={data} set={set} />
          <Group title={t('settings.preview')}>
            <div className="flex flex-wrap gap-2">
              {preview?.map((p) => (
                <span key={p} dir="ltr" className="rounded-lg border border-[rgb(var(--c-primary)/0.4)] bg-[rgb(var(--c-primary-soft))] px-2.5 py-1 font-mono text-[13px] font-bold">
                  {p}
                </span>
              ))}
            </div>
            <p className="text-[11.5px] text-[rgb(var(--c-muted))]">{t('settings.previewHint')}</p>
          </Group>
        </div>
      );

    case 'languages':
      return (
        <Group title={t('settings.groups.locale')}>
          <Grid cols={3}>
            <Field label={t('settings.defaultLang')}>
              <Select value={s('default')} onChange={(e) => set('default', e.target.value)} options={['fr', 'ar', 'es', 'en'].map((x) => ({ value: x, label: x }))} />
            </Field>
            <Field label={t('settings.fallbackLang')}>
              <Select value={s('fallback')} onChange={(e) => set('fallback', e.target.value)} options={['fr', 'ar', 'es', 'en'].map((x) => ({ value: x, label: x }))} />
            </Field>
            <div className="rounded-xl border border-[rgb(var(--c-line)/0.6)] p-3">
              <span className="mb-1.5 block text-[12.5px] font-semibold">{t('settings.enabledLangs')}</span>
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
          </Grid>
        </Group>
      );

    case 'smtp':
      return (
        <div className="flex flex-col gap-5">
          <Group title={t('settings.groups.smtpServer')}>
            <Grid cols={4}>
              <Field label={t('settings.smtp.host')} className="xl:col-span-2">
                <Input value={s('host')} onChange={(e) => set('host', e.target.value)} />
              </Field>
              <Field label={t('settings.smtp.port')}>
                <Input type="number" min={1} max={65535} value={n('port', 465)} onChange={(e) => set('port', Number(e.target.value))} />
              </Field>
              <Field label={t('settings.smtp.user')} className="xl:col-span-2">
                <Input value={s('user')} onChange={(e) => set('user', e.target.value)} autoComplete="off" />
              </Field>
              <Field label={t('settings.smtp.password')} hint={tc('settings.secretKeep')}>
                <Input type="password" value={s('password')} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
              </Field>
              <Field label={t('settings.smtp.from')}>
                <Input type="email" value={s('from')} onChange={(e) => set('from', e.target.value)} />
              </Field>
            </Grid>
          </Group>
          <Grid cols={3}>
            <Row label={t('settings.smtp.enabled')} on={Boolean(data.enabled)} onChange={(v) => set('enabled', v)} />
            <Row label={t('settings.smtp.secure')} on={Boolean(data.secure)} onChange={(v) => set('secure', v)} />
          </Grid>
        </div>
      );

    case 'medicalRefs': {
      const rows = (k: string): { code: string; label: Record<string, string>; active?: boolean }[] =>
        Array.isArray(data[k]) ? (data[k] as { code: string; label: Record<string, string>; active?: boolean }[]) : [];
      return (
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-[rgb(var(--c-muted))]">{t('settings.medicalRefs.hint')}</p>
          <div className="grid gap-4 2xl:grid-cols-2">
            <RefCrudTable title={t('settings.medicalRefs.blood')} items={rows('bloodGroups')} onChange={(v) => set('bloodGroups', v)} />
            <RefCrudTable title={t('settings.medicalRefs.funds')} items={rows('ssFunds')} onChange={(v) => set('ssFunds', v)} />
          </div>
        </div>
      );
    }

    default:
      return <p className="text-[13px] text-[rgb(var(--c-muted))]">{t('settings.jsonOnlyHint')}</p>;
  }
}

/** Erreurs → texte lisible et TRADUIT (« types.0.prefix : Préfixe attendu : 2 à 5 majuscules. »). */
function describeIssues(errors: Record<string, string>, vars: Record<string, Record<string, string | number>>, t: (k: string, v?: Record<string, string | number>) => string): string {
  return Object.entries(errors)
    .map(([path, code]) => `${path === '_' ? '' : `${path} : `}${t(`settings.validation.${code}`, vars[path] ?? {})}`)
    .join(' · ');
}

/**
 * Barre d'enregistrement collante : l'état du formulaire est toujours visible (« à jour » /
 * « modifications non enregistrées »), le retour à la version serveur est à un clic, et le bouton
 * Enregistrer ne s'active que s'il y a réellement quelque chose à écrire.
 */
function SaveBar({ dirty, saving, invalidCount = 0, onSave, onReset }: { dirty: boolean; saving: boolean; invalidCount?: number; onSave: () => void; onReset: () => void }): React.ReactElement {
  const { t } = useT('settings');
  const { t: tc } = useT('common');
  return (
    <div className="sticky bottom-0 z-10 -mx-4 -mb-4 mt-auto flex flex-wrap items-center gap-2 rounded-b-[var(--r-card)] border-t border-[rgb(var(--c-line)/0.7)] bg-[rgb(var(--c-surface)/0.93)] px-4 py-2.5 backdrop-blur">
      <Badge tone={dirty ? 'warn' : 'ok'}>{dirty ? t('settings.save.dirty') : t('settings.save.upToDate')}</Badge>
      {invalidCount > 0 ? <Badge tone="danger">{t('settings.save.invalid', { n: invalidCount })}</Badge> : null}
      <div className="ms-auto flex items-center gap-2">
        <Button onClick={onReset} disabled={!dirty} title={t('settings.save.discard')}>
          <RotateCcw size={14} /> {t('settings.save.discard')}
        </Button>
        <Button variant="primary" loading={saving} disabled={!dirty || invalidCount > 0} title={invalidCount > 0 ? t('settings.save.invalidHint') : undefined} onClick={onSave}>
          <Save size={14} /> {tc('save')}
        </Button>
      </div>
    </div>
  );
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
    <Card soft className="flex flex-col gap-2 !p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[14px] font-bold">{title}</h3>
        <Button size="sm" variant="primary" onClick={openNew}>
          <Plus size={13} /> {tc('new')}
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-[rgb(var(--c-line))]">
        <table className="dt-table">
          <thead>
            <tr>
              <th>{tc('code')}</th>
              <th>FR</th>
              <th>ع</th>
              <th>ES</th>
              <th>EN</th>
              <th>{tc('active')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((x, i) => (
              <tr key={`${x.code}-${i}`}>
                <td dir="ltr" className="font-mono text-[12.5px] font-bold">
                  {x.code}
                </td>
                <td className="text-[12.5px]">{x.label?.fr}</td>
                <td dir="rtl" className="text-[12.5px]">
                  {x.label?.ar}
                </td>
                <td className="text-[12.5px]">{x.label?.es}</td>
                <td className="text-[12.5px]">{x.label?.en}</td>
                <td>{x.active === false ? <Badge>—</Badge> : <Badge tone="ok">✓</Badge>}</td>
                <td>
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" className="btn-icon !min-h-7 !min-w-7" title={tc('edit')} onClick={() => openEdit(i)}>
                      <Pencil size={13} />
                    </Button>
                    <Button size="sm" variant="ghost" className="btn-icon !min-h-7 !min-w-7" title={x.active === false ? t('settings.ref.enable') : t('settings.ref.disable')} onClick={() => toggle(i)}>
                      {x.active === false ? '↺' : '⏻'}
                    </Button>
                    <Button size="sm" variant="ghost" className="btn-icon !min-h-7 !min-w-7" title={tc('delete')} onClick={() => remove(i)}>
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {!items.length ? (
              <tr>
                <td colSpan={7} className="py-3 text-center text-[13px] text-[rgb(var(--c-muted))]">
                  —
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <Drawer
        open={Boolean(drawer)}
        onClose={() => setDrawer(null)}
        title={drawer?.mode === 'edit' ? `${tc('edit')} — ${title}` : `${tc('new')} — ${title}`}
        footer={
          <>
            <Button onClick={() => setDrawer(null)}>{tc('cancel')}</Button>
            <Button variant="primary" disabled={!form.code.trim()} onClick={commit}>
              {tc('save')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label={tc('code')} required>
            <Input className="font-mono" value={form.code} placeholder="A+ / CNAS" onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
          </Field>
          {(['fr', 'ar', 'es', 'en'] as const).map((lg) => (
            <Field key={lg} label={lg.toUpperCase()}>
              <Input dir={lg === 'ar' ? 'rtl' : undefined} value={form.label?.[lg] ?? ''} onChange={(e) => setForm({ ...form, label: { ...form.label, [lg]: e.target.value } })} />
            </Field>
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
        <h3 className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-widest text-[rgb(var(--c-muted))]">
          <Hash size={13} /> {t('settings.codification.table')}
        </h3>
        <Button size="sm" variant="ghost" onClick={() => void q.refetch()}>
          <RefreshCw size={13} /> {t('settings.codification.refresh')}
        </Button>
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
                    <span dir="ltr" className="font-mono text-[12px] text-[rgb(var(--c-muted))]">
                      {r.prefix}
                    </span>
                  )}
                </td>
                <td>
                  <Input type="number" min={2} max={8} className="!min-h-8 w-20 !text-[13px]" value={Number(data[r.paddingField] ?? r.padding)} onChange={(e) => set(r.paddingField, Number(e.target.value))} />
                </td>
                <td className="text-center font-mono text-[13px]">{r.separator}</td>
                <td className="text-center font-mono text-[13px] tabular-nums">{r.currentSeq}</td>
                <td>
                  <span dir="ltr" className="rounded-lg border border-[rgb(var(--c-primary)/0.4)] bg-[rgb(var(--c-primary-soft))] px-2 py-0.5 font-mono text-[12px] font-bold">
                    {r.nextPreview}
                  </span>
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={6} className="py-3 text-center text-[13px] text-[rgb(var(--c-muted))]">
                  …
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="text-[11.5px] text-[rgb(var(--c-muted))]">{t('settings.codification.hint')}</p>
    </div>
  );
}

/**
 * Interrupteur étiqueté. Le libellé est AU-DESSUS du bandeau (comme celui d'un Field) : placé dans
 * une même grille qu'un champ texte, il s'aligne au lieu de flotter plus haut.
 */
function Row({ label, on, onChange, className }: { label: string; on: boolean; onChange: (v: boolean) => void; className?: string }): React.ReactElement {
  return (
    <div className={cn('flex flex-col', className)}>
      <span className="mb-1 block text-[12.5px] font-semibold text-[rgb(var(--c-ink)/0.8)]">{label}</span>
      <div className="flex min-h-[var(--row-h)] items-center justify-between gap-3 rounded-xl border border-[rgb(var(--c-line)/0.6)] px-3">
        <span className="sr-only">{label}</span>
        <Switch checked={on} onChange={onChange} />
      </div>
    </div>
  );
}
