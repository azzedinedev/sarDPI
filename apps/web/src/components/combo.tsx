'use client';
/**
 * CONTRÔLES DE FORMULAIRE AVANCÉS — reliés à react-hook-form (comme RichEditor).
 * - Autocomplete : saisie libre filtrée + liste déroulante en portail (jamais rognée par le Drawer).
 * - Multiselect  : filtre + cases à cocher + puces (chips) ; la valeur est un tableau.
 * - StringList   : ajouts successifs de textes (« + ») — allergènes, antécédents… ; valeur = tableau.
 * Les trois s'appuient sur le PopMenu (portail <body>) pour que la liste flotte au-dessus de tout.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { X, Plus } from 'lucide-react';
import { PopMenu } from '@/components/popover';
import { cn } from '@/lib/utils';

export interface ComboOption {
  value: string;
  label: string;
  sublabel?: string;
}

function normalize(options: ComboOption[] | undefined): ComboOption[] {
  return (options ?? []).map((o) => ({ value: String(o.value), label: String(o.label ?? o.value), sublabel: o.sublabel != null ? String(o.sublabel) : undefined }));
}

function toList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((v) => String(v));
  if (raw == null || raw === '') return [];
  return String(raw)
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Liste de suggestions clavier + souris, rendue dans le panneau PopMenu. */
function OptionList({
  items,
  active,
  multiple,
  selected,
  onPick,
  emptyLabel,
}: {
  items: ComboOption[];
  active: number;
  multiple: boolean;
  selected: (o: ComboOption) => boolean;
  onPick: (o: ComboOption) => void;
  emptyLabel: string;
}): React.ReactElement {
  return (
    <div role="listbox" className="max-h-64 w-full min-w-56 overflow-y-auto" dir="auto">
      {items.length === 0 ? (
        <p className="px-2 py-3 text-center text-[12.5px] text-[rgb(var(--c-muted))]">{emptyLabel}</p>
      ) : (
        items.map((o, i) => (
          <button
            key={o.value}
            type="button"
            role="option"
            aria-selected={selected(o)}
            onMouseDown={(e) => e.preventDefault() /* ne pas voler le focus avant le clic */}
            onClick={() => onPick(o)}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-[13px] hover:bg-[rgb(var(--c-primary-soft))]',
              i === active && 'bg-[rgb(var(--c-primary-soft))] ring-1 ring-[rgb(var(--c-primary)/0.35)]',
              selected(o) && 'font-semibold text-[rgb(var(--c-primary))]',
            )}
          >
            {multiple ? (
              <span className={cn('grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px]', selected(o) ? 'border-[rgb(var(--c-primary))] bg-[rgb(var(--c-primary))] text-white' : 'border-[rgb(var(--c-line))]')}>{selected(o) ? '✓' : ''}</span>
            ) : null}
            <span dir="auto" className="min-w-0 flex-1 truncate">{o.label}</span>
            {o.sublabel ? <span dir="ltr" className="font-mono text-[10.5px] text-[rgb(var(--c-muted))]">{o.sublabel}</span> : null}
          </button>
        ))
      )}
    </div>
  );
}

function useComboState(options: ComboOption[] | undefined) {
  const items = useMemo(() => normalize(options), [options]);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return items.slice(0, 60);
    return items.filter((o) => o.label.toLowerCase().includes(t) || o.value.toLowerCase().includes(t) || (o.sublabel ?? '').toLowerCase().includes(t)).slice(0, 60);
  }, [items, q]);
  return { items, anchorRef, open, setOpen, q, setQ, active, setActive, filtered };
}

/* ------------------------------------------------------------------ Autocomplete */
export function Autocomplete({
  name,
  options,
  disabled,
  placeholder,
  emptyLabel = 'Aucune correspondance',
}: {
  name: string;
  options?: ComboOption[];
  disabled?: boolean;
  placeholder?: string;
  emptyLabel?: string;
}): React.ReactElement {
  const { setValue, watch } = useFormContext<Record<string, unknown>>();
  const value = String(watch(name) ?? '');
  const sel = normalize(options).find((o) => o.value === value);
  const st = useComboState(options);
  const shown = st.open ? st.q : sel?.label ?? value;

  const pick = (o: ComboOption): void => {
    setValue(name, o.value, { shouldDirty: true });
    st.setOpen(false);
  };
  const key = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      st.setOpen(true);
      st.setActive((a) => (st.filtered.length ? (a + (e.key === 'ArrowDown' ? 1 : -1) + st.filtered.length) % st.filtered.length : 0));
    } else if (e.key === 'Enter' && st.open && st.filtered[st.active]) {
      e.preventDefault();
      pick(st.filtered[st.active]!);
    } else if (e.key === 'Escape') st.setOpen(false);
  };

  return (
    <div ref={st.anchorRef} className="relative">
      <input
        dir="auto"
        disabled={disabled}
        role="combobox"
        aria-expanded={st.open}
        className="field !pe-8"
        placeholder={placeholder}
        value={shown}
        onFocus={() => {
          st.setQ(sel ? '' : '');
          st.setActive(0);
          st.setOpen(true);
        }}
        onChange={(e) => {
          st.setQ(e.target.value);
          st.setActive(0);
          st.setOpen(true);
          if (!e.target.value) setValue(name, '', { shouldDirty: true });
        }}
        onKeyDown={key}
      />
      {sel || !value ? null : (
        <button type="button" className="absolute inset-y-0 end-1 my-auto grid h-6 w-6 place-items-center rounded-md text-[rgb(var(--c-muted))] hover:bg-[rgb(var(--c-surface))]" onClick={() => setValue(name, '', { shouldDirty: true })} aria-label="effacer">
          <X size={13} />
        </button>
      )}
      <PopMenu open={st.open} onClose={() => st.setOpen(false)} anchor={st.anchorRef} matchWidth className="p-1">
        <OptionList items={st.filtered} active={st.active} multiple={false} selected={(o) => o.value === value} onPick={pick} emptyLabel={emptyLabel} />
      </PopMenu>
    </div>
  );
}

/* ------------------------------------------- AsyncAutocomplete (contrôlé, hors formulaire) */
/**
 * Autocomplete contrôlé pour les dialogs (agenda, création rapide) : recherche LOCALE (options)
 * ou DISTANTE (fetchOptions, anti-rebond). Rends la liste dans un portail (jamais rognée).
 */
export function AsyncAutocomplete({
  value,
  options,
  fetchOptions,
  onChange,
  placeholder,
  disabled,
  emptyLabel = 'Aucune correspondance',
  minChars = 0,
}: {
  value: ComboOption | null;
  options?: ComboOption[];
  fetchOptions?: (q: string) => Promise<ComboOption[]>;
  onChange: (o: ComboOption | null) => void;
  placeholder?: string;
  disabled?: boolean;
  emptyLabel?: string;
  minChars?: number;
}): React.ReactElement {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState<ComboOption[]>([]);
  const [loading, setLoading] = useState(false);
  const items = useMemo(() => normalize(fetchOptions ? remote : options), [fetchOptions, remote, options]);

  useEffect(() => {
    if (!fetchOptions || !open) return;
    const term = q.trim();
    if (term.length < minChars) {
      setRemote([]);
      return;
    }
    let cancelled = false;
    const id = setTimeout(() => {
      setLoading(true);
      void fetchOptions(term)
        .then((r) => {
          if (!cancelled) setRemote(r ?? []);
        })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [q, open, fetchOptions, minChars]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return items.slice(0, 60);
    return items.filter((o) => o.label.toLowerCase().includes(t) || o.value.toLowerCase().includes(t) || (o.sublabel ?? '').toLowerCase().includes(t)).slice(0, 60);
  }, [items, q]);

  const shown = open ? q : value?.label ?? '';
  const pick = (o: ComboOption): void => {
    onChange(o);
    setOpen(false);
    setQ('');
  };
  const key = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (filtered.length ? (a + (e.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length : 0));
    } else if (e.key === 'Enter' && open && filtered[active]) {
      e.preventDefault();
      pick(filtered[active]!);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={anchorRef} className="relative">
      <input
        dir="auto"
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        className="field !pe-8"
        placeholder={placeholder}
        value={shown}
        onFocus={() => {
          setQ('');
          setActive(0);
          setOpen(true);
        }}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
          setOpen(true);
          if (!e.target.value && value) onChange(null);
        }}
        onKeyDown={key}
      />
      {value ? (
        <button type="button" className="absolute inset-y-0 end-1 my-auto grid h-6 w-6 place-items-center rounded-md text-[rgb(var(--c-muted))] hover:bg-[rgb(var(--c-surface))]" onClick={() => { onChange(null); setQ(''); }} aria-label="effacer">
          <X size={13} />
        </button>
      ) : null}
      <PopMenu open={open} onClose={() => setOpen(false)} anchor={anchorRef} matchWidth className="p-1">
        {loading ? <p className="px-2 py-1.5 text-[12px] text-[rgb(var(--c-muted))]">…</p> : null}
        <OptionList items={filtered} active={active} multiple={false} selected={(o) => o.value === value?.value} onPick={pick} emptyLabel={emptyLabel} />
      </PopMenu>
    </div>
  );
}

/* ------------------------------------------------------------------ Multiselect */
export function Multiselect({
  name,
  options,
  disabled,
  placeholder,
  emptyLabel = 'Aucune correspondance',
}: {
  name: string;
  options?: ComboOption[];
  disabled?: boolean;
  placeholder?: string;
  emptyLabel?: string;
}): React.ReactElement {
  const { setValue, watch } = useFormContext<Record<string, unknown>>();
  const value = toList(watch(name));
  const all = normalize(options);
  const st = useComboState(options);

  const commit = (next: string[]): void => setValue(name, next, { shouldDirty: true });
  const toggle = (o: ComboOption): void => {
    commit(value.includes(o.value) ? value.filter((v) => v !== o.value) : [...value, o.value]);
  };
  const labelOf = (v: string): string => all.find((o) => o.value === v)?.label ?? v;

  return (
    <div ref={st.anchorRef} className="relative">
      <div
        role="combobox"
        aria-expanded={st.open}
        tabIndex={disabled ? -1 : 0}
        onFocus={() => st.setOpen(true)}
        onClick={() => st.setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Escape') st.setOpen(false); }}
        className={cn('field flex min-h-10 flex-wrap items-center gap-1.5 cursor-text', !value.length && 'text-[rgb(var(--c-muted))]')}
      >
        {value.length === 0 ? <span className="text-[13px]">{placeholder ?? '—'}</span> : value.map((v) => (
          <span key={v} dir="auto" className="chip inline-flex items-center gap-1 rounded-full border border-[rgb(var(--c-primary)/0.35)] bg-[rgb(var(--c-primary-soft))] px-2 py-0.5 text-[12px] font-semibold text-[rgb(var(--c-primary))]">
            {labelOf(v)}
            {!disabled ? (
              <button type="button" onClick={(e) => { e.stopPropagation(); commit(value.filter((x) => x !== v)); }} aria-label="retirer" className="text-[rgb(var(--c-muted))] hover:text-[rgb(var(--c-danger))]">
                <X size={11} />
              </button>
            ) : null}
          </span>
        ))}
        <input
          dir="auto"
          disabled={disabled}
          className="min-w-16 flex-1 border-0 bg-transparent p-0 text-[13px] outline-none"
          placeholder={value.length ? '' : 'Filtrer…'}
          value={st.q}
          onChange={(e) => { st.setQ(e.target.value); st.setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !st.q && value.length) commit(value.slice(0, -1));
            else if (e.key === 'Enter' && st.filtered[st.active]) { e.preventDefault(); toggle(st.filtered[st.active]!); }
            else if (e.key === 'Escape') st.setOpen(false);
          }}
        />
      </div>
      <PopMenu open={st.open} onClose={() => { st.setOpen(false); st.setQ(''); }} anchor={st.anchorRef} matchWidth className="p-1">
        <OptionList items={st.filtered} active={st.active} multiple selected={(o) => value.includes(o.value)} onPick={toggle} emptyLabel={emptyLabel} />
      </PopMenu>
    </div>
  );
}

/* ------------------------------------------------------------------ StringList (+ champs) */
export function StringList({
  name,
  placeholder,
  disabled,
  addLabel = 'Ajouter',
}: {
  name: string;
  placeholder?: string;
  disabled?: boolean;
  addLabel?: string;
}): React.ReactElement {
  const { setValue, watch } = useFormContext<Record<string, unknown>>();
  const value = toList(watch(name));
  const rows = value.length ? value : [''];
  const commit = (next: string[]): void => setValue(name, next.filter((s) => s.trim()), { shouldDirty: true });
  const setRow = (i: number, txt: string): void => commit(rows.map((r, j) => (j === i ? txt : r)));

  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Inputish
            value={r}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(t) => setRow(i, t)}
            onEnter={() => {
              if (i === rows.length - 1 && r.trim()) commit([...rows, '']);
            }}
          />
          <button
            type="button"
            disabled={disabled || (rows.length === 1 && !r)}
            onClick={() => commit(rows.filter((_, j) => j !== i).length ? rows.filter((_, j) => j !== i) : [''])}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[rgb(var(--c-line))] text-[rgb(var(--c-muted))] hover:border-[rgb(var(--c-danger))] hover:text-[rgb(var(--c-danger))] disabled:opacity-40"
            aria-label="supprimer la ligne"
          >
            <X size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={disabled}
        onClick={() => commit([...rows.filter(Boolean), ''])}
        className="inline-flex w-fit items-center gap-1 rounded-lg border border-dashed border-[rgb(var(--c-line))] px-2.5 py-1.5 text-[12.5px] font-semibold text-[rgb(var(--c-primary))] hover:border-[rgb(var(--c-primary))]"
      >
        <Plus size={13} /> {addLabel}
      </button>
    </div>
  );
}

function Inputish({ value, onChange, onEnter, placeholder, disabled }: { value: string; onChange: (v: string) => void; onEnter?: () => void; placeholder?: string; disabled?: boolean }): React.ReactElement {
  return (
    <input
      dir="auto"
      className="field flex-1"
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter?.(); } }}
    />
  );
}
