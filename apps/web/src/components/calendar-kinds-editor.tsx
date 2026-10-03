'use client';
/**
 * Éditeur des étiquettes du calendrier — types de rendez-vous (`kind`) et statuts (`status`).
 * --------------------------------------------------------------------------------------------
 * Ces étiquettes vivaient auparavant en dur dans le client (5 types, 5 statuts). Elles sont
 * désormais stockées dans le réglage « calendarKinds » : libellés multilingues (fr/ar/es/en),
 * couleur et durée par défaut. Ajouter un type de RDV ne demande donc plus aucune modification
 * de code (même principe que les étapes de suivi / workflowSteps).
 *
 * Lecture publique localisée : GET /refs/display (permission « authentifié » seulement).
 * Écriture : PUT /admin/settings/calendarKinds (permission « setting:update »).
 * Les clés existantes sont verrouillées : elles sont stockées dans appointments.kind/.status,
 * les renommer orphelinerait les rendez-vous déjà enregistrés.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Button, Field, Input, Switch, Tabs } from '@/components/ui';
import { Dialog } from '@/components/dialogs';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/utils';

/** Langues éditées — ordre figé, identique à celui du générateur de traductions. */
const LANGS = ['fr', 'ar', 'es', 'en'] as const;
/** Contrainte serveur sur la clé (calendarKindsZ) : minuscules et tiret bas, 2 à 30 caractères. */
const KEY_RE = /^[a-z_]{2,30}$/;

interface KindRow {
  key: string;
  color: string;
  durationMin: number;
  active: boolean;
  label: Record<string, string>;
  /** Ligne ajoutée localement : sa clé reste modifiable (rien n'est encore stocké). */
  isNew?: boolean;
}
interface StatusRow {
  key: string;
  color: string;
  label: Record<string, string>;
  isNew?: boolean;
}
interface Section {
  kinds: KindRow[];
  statuses: StatusRow[];
}

const EMPTY: Section = { kinds: [], statuses: [] };

function blankLabel(): Record<string, string> {
  return { fr: '', ar: '', es: '', en: '' };
}

export function CalendarKindsDialog({ open, onClose }: { open: boolean; onClose: () => void }): React.ReactElement | null {
  const { t } = useT('patient');
  const { t: tc } = useT('common');
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'kinds' | 'statuses'>('kinds');
  const [draft, setDraft] = useState<Section>(EMPTY);
  const [touched, setTouched] = useState(false);

  const q = useQuery({
    queryKey: ['settings', 'calendarKinds'],
    enabled: open,
    queryFn: () => api.get<Section>('/admin/settings/calendarKinds'),
  });

  // Rechargement à chaque ouverture : on repart toujours de la valeur stockée (jamais d'un
  // brouillon périmé), sauf si l'utilisateur a des modifications non enregistrées.
  useEffect(() => {
    if (!open) return;
    if (touched) return;
    const d = q.data;
    if (!d) return;
    setDraft({
      kinds: (d.kinds ?? []).map((k) => ({ ...k, label: { ...blankLabel(), ...(k.label ?? {}) } })),
      statuses: (d.statuses ?? []).map((s) => ({ ...s, label: { ...blankLabel(), ...(s.label ?? {}) } })),
    });
  }, [open, q.data, touched]);

  useEffect(() => {
    if (open) {
      setTouched(false);
      setTab('kinds');
    }
  }, [open]);

  /** Erreurs bloquantes (clés invalides/doublons, libellé FR vide) — affichées sous le bouton. */
  const problems = useMemo<string[]>(() => {
    const out: string[] = [];
    const check = (rows: { key: string; label: Record<string, string> }[], what: string): void => {
      const seen = new Set<string>();
      for (const r of rows) {
        const k = r.key.trim();
        if (!KEY_RE.test(k)) out.push(t('appt.kindBadKey', { key: k || '—' }));
        else if (seen.has(k)) out.push(t('appt.kindDupKey', { key: k }));
        seen.add(k);
        const any = LANGS.some((l) => (r.label?.[l] ?? '').trim() !== '');
        if (!any) out.push(t('appt.kindNoLabel', { key: k || '—' }));
        else if (!(r.label?.fr ?? '').trim()) out.push(t('appt.kindNoFr', { key: k || '—' }));
      }
      if (rows.length === 0) out.push(t('appt.kindEmpty', { what }));
    };
    check(draft.kinds, t('appt.kindsTab'));
    check(draft.statuses, t('appt.statusTab'));
    return out;
  }, [draft, t]);

  const save = useMutation({
    mutationFn: (payload: Section) => api.put<{ ok: boolean }>('/admin/settings/calendarKinds', payload),
    onSuccess: () => {
      setTouched(false);
      toast.success(t('appt.kindsSaved'));
      // Le calendrier lit les étiquettes via /refs/display : on invalide les deux caches.
      void qc.invalidateQueries({ queryKey: ['refs', 'display'] });
      void qc.invalidateQueries({ queryKey: ['settings', 'calendarKinds'] });
      onClose();
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : tc('errors.errors.server'));
    },
  });

  const setKinds = (fn: (rows: KindRow[]) => KindRow[]): void => {
    setTouched(true);
    setDraft((d) => ({ ...d, kinds: fn(d.kinds) }));
  };
  const setStatuses = (fn: (rows: StatusRow[]) => StatusRow[]): void => {
    setTouched(true);
    setDraft((d) => ({ ...d, statuses: fn(d.statuses) }));
  };

  /** Déplace une ligne (ordre affiché = ordre stocké). */
  const move = <T,>(rows: T[], i: number, dir: -1 | 1): T[] => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return rows;
    const out = [...rows];
    const [it] = out.splice(i, 1);
    out.splice(j, 0, it as T);
    return out;
  };

  const onSubmit = (): void => {
    if (problems.length > 0) return;
    save.mutate({
      kinds: draft.kinds.map((k, i) => ({ key: k.key.trim(), order: i + 1, color: k.color, durationMin: Number(k.durationMin) || 30, active: k.active !== false, label: cleanLabel(k.label) })),
      statuses: draft.statuses.map((s, i) => ({ key: s.key.trim(), order: i + 1, color: s.color, label: cleanLabel(s.label) })),
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title={t('appt.kindsTitle')}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-[11.5px] text-[rgb(var(--c-muted))]">{touched ? tc('ui.unsaved') : ''}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>
              {tc('cancel')}
            </Button>
            <Button size="sm" variant="primary" disabled={problems.length > 0 || save.isPending || q.isLoading} onClick={onSubmit}>
              {save.isPending ? tc('saving') : tc('save')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="rounded-xl bg-[rgb(var(--c-primary-soft)/0.55)] px-3 py-2 text-[12.5px] leading-relaxed text-[rgb(var(--c-ink))]">{t('appt.kindsHint')}</p>

        <Tabs
          active={tab}
          onChange={(k) => setTab(k as 'kinds' | 'statuses')}
          tabs={[
            { key: 'kinds', label: t('appt.kindsTab'), badge: draft.kinds.length },
            { key: 'statuses', label: t('appt.statusTab'), badge: draft.statuses.length },
          ]}
        />

        {q.isLoading ? (
          <div className="skeleton-stagger flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-16 w-full" />
            ))}
          </div>
        ) : tab === 'kinds' ? (
          <div className="flex flex-col gap-2">
            {draft.kinds.map((k, i) => (
              <div key={`${k.key}-${i}`} className="glass-soft flex flex-col gap-2 p-2.5">
                <div className="flex flex-wrap items-end gap-2">
                  <Field label={t('appt.kindColor')} className="w-[64px]">
                    <input
                      type="color"
                      aria-label={t('appt.kindColor')}
                      className="h-9 w-full cursor-pointer rounded-lg border border-[rgb(var(--c-line))] bg-transparent p-0.5"
                      value={k.color}
                      onChange={(e) => setKinds((rows) => rows.map((r, x) => (x === i ? { ...r, color: e.target.value } : r)))}
                    />
                  </Field>
                  <Field label={t('appt.kindKey')} className="min-w-[150px] flex-1" hint={k.isNew ? undefined : t('appt.kindKeyLocked')}>
                    <Input
                      value={k.key}
                      invalid={k.key.trim() !== '' && !KEY_RE.test(k.key.trim())}
                      disabled={!k.isNew}
                      placeholder="consultation"
                      dir="ltr"
                      onChange={(e) => setKinds((rows) => rows.map((r, x) => (x === i ? { ...r, key: e.target.value } : r)))}
                    />
                  </Field>
                  <Field label={t('appt.kindDuration')} className="w-[110px]">
                    <Input
                      type="number"
                      min={5}
                      max={480}
                      step={5}
                      dir="ltr"
                      value={String(k.durationMin)}
                      onChange={(e) => setKinds((rows) => rows.map((r, x) => (x === i ? { ...r, durationMin: Number(e.target.value) } : r)))}
                    />
                  </Field>
                  <Field label={tc('active')} className="w-[86px]">
                    <Switch checked={k.active !== false} onChange={(v) => setKinds((rows) => rows.map((r, x) => (x === i ? { ...r, active: v } : r)))} />
                  </Field>
                  <div className="ms-auto flex items-center gap-1 pb-1">
                    <Button size="sm" variant="ghost" aria-label={tc('up')} onClick={() => setKinds((rows) => move(rows, i, -1))}>
                      <ArrowUp size={14} />
                    </Button>
                    <Button size="sm" variant="ghost" aria-label={tc('down')} onClick={() => setKinds((rows) => move(rows, i, 1))}>
                      <ArrowDown size={14} />
                    </Button>
                    <Button size="sm" variant="ghost" aria-label={tc('delete')} onClick={() => setKinds((rows) => rows.filter((_, x) => x !== i))}>
                      <Trash2 size={14} className="text-[rgb(var(--c-coral))]" />
                    </Button>
                  </div>
                </div>
                <LabelGrid label={k.label} onChange={(lab) => setKinds((rows) => rows.map((r, x) => (x === i ? { ...r, label: lab } : r)))} />
                {/* Aperçu immédiat : la pastille utilise la couleur réellement stockée. */}
                <div className="flex items-center gap-1.5 text-[11.5px] text-[rgb(var(--c-muted))]">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: k.color }} />
                  {t('appt.kindPreview')} : <span className="font-semibold text-[rgb(var(--c-ink))]">{k.label?.fr || k.key}</span>
                  <span className={cn('badge', !k.active && 'opacity-60')}>{k.active ? tc('active') : tc('archived')}</span>
                </div>
              </div>
            ))}
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setKinds((rows) => [
                  ...rows,
                  { key: '', color: '#0ea5b7', durationMin: 30, active: true, label: blankLabel(), isNew: true },
                ])
              }
            >
              <Plus size={14} /> {t('appt.kindAdd')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {draft.statuses.map((s, i) => (
              <div key={`${s.key}-${i}`} className="glass-soft flex flex-col gap-2 p-2.5">
                <div className="flex flex-wrap items-end gap-2">
                  <Field label={t('appt.kindColor')} className="w-[64px]">
                    <input
                      type="color"
                      aria-label={t('appt.kindColor')}
                      className="h-9 w-full cursor-pointer rounded-lg border border-[rgb(var(--c-line))] bg-transparent p-0.5"
                      value={s.color}
                      onChange={(e) => setStatuses((rows) => rows.map((r, x) => (x === i ? { ...r, color: e.target.value } : r)))}
                    />
                  </Field>
                  <Field label={t('appt.kindKey')} className="min-w-[150px] flex-1" hint={s.isNew ? undefined : t('appt.kindKeyLocked')}>
                    <Input
                      value={s.key}
                      invalid={s.key.trim() !== '' && !KEY_RE.test(s.key.trim())}
                      disabled={!s.isNew}
                      placeholder="pending"
                      dir="ltr"
                      onChange={(e) => setStatuses((rows) => rows.map((r, x) => (x === i ? { ...r, key: e.target.value } : r)))}
                    />
                  </Field>
                  <div className="ms-auto flex items-center gap-1 pb-1">
                    <Button size="sm" variant="ghost" aria-label={tc('up')} onClick={() => setStatuses((rows) => move(rows, i, -1))}>
                      <ArrowUp size={14} />
                    </Button>
                    <Button size="sm" variant="ghost" aria-label={tc('down')} onClick={() => setStatuses((rows) => move(rows, i, 1))}>
                      <ArrowDown size={14} />
                    </Button>
                    <Button size="sm" variant="ghost" aria-label={tc('delete')} onClick={() => setStatuses((rows) => rows.filter((_, x) => x !== i))}>
                      <Trash2 size={14} className="text-[rgb(var(--c-coral))]" />
                    </Button>
                  </div>
                </div>
                <LabelGrid label={s.label} onChange={(lab) => setStatuses((rows) => rows.map((r, x) => (x === i ? { ...r, label: lab } : r)))} />
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setStatuses((rows) => [...rows, { key: '', color: '#64748b', label: blankLabel(), isNew: true }])}>
              <Plus size={14} /> {t('appt.statusAdd')}
            </Button>
          </div>
        )}

        {problems.length > 0 ? (
          <ul className="flex flex-col gap-1 rounded-xl bg-[rgb(var(--c-coral-soft))] px-3 py-2 text-[12px] font-semibold text-[rgb(var(--c-coral))]">
            {problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </Dialog>
  );
}

/** Les 4 libellés linguistiques d'une ligne — le français sert de repli côté serveur. */
function LabelGrid({ label, onChange }: { label: Record<string, string>; onChange: (l: Record<string, string>) => void }): React.ReactElement {
  const { t } = useT('patient');
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {LANGS.map((l) => (
        <Field key={l} label={t(`appt.labelLang.${l}`)} className="min-w-0">
          <Input
            value={label?.[l] ?? ''}
            dir={l === 'ar' ? 'rtl' : 'ltr'}
            placeholder={l === 'fr' ? 'Consultation' : ''}
            onChange={(e) => onChange({ ...(label ?? {}), [l]: e.target.value })}
          />
        </Field>
      ))}
    </div>
  );
}

/** Retire les libellés vides : un « » stocké écraserait le repli vers le français. */
function cleanLabel(label: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of LANGS) {
    const v = (label?.[l] ?? '').trim();
    if (v) out[l] = v;
  }
  return out;
}
