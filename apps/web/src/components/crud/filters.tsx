'use client';
/** Constructeur de filtres avancés (ET/OU) + filtres enregistrés (localStorage par ressource). */
import React, { useState } from 'react';
import { Plus, Save, Trash2, Filter as FilterIcon, Bookmark } from 'lucide-react';
import type { FilterGroup, FilterItem } from '@sardpi/shared';
import { Button, Input, Select } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { SavedFilter } from './types';

export interface FilterFieldDef {
  field: string;
  label: string;
  kind?: string;
  options?: { value: string | number; label: string }[];
}

const OPS: { v: FilterItem['op']; label: string }[] = [
  { v: 'contains', label: 'contains' },
  { v: 'eq', label: '=' },
  { v: 'neq', label: '≠' },
  { v: 'gt', label: '>' },
  { v: 'gte', label: '≥' },
  { v: 'lt', label: '<' },
  { v: 'lte', label: '≤' },
  { v: 'between', label: '↔' },
  { v: 'empty', label: '∅' },
  { v: 'notEmpty', label: '≠∅' },
];

export function FilterBuilder({
  fields,
  value,
  onChange,
  resource,
}: {
  fields: FilterFieldDef[];
  value: FilterGroup;
  onChange: (g: FilterGroup) => void;
  resource: string;
}): React.ReactElement {
  const { t } = useT('common');
  const [saved, setSaved] = useState<SavedFilter[]>(() => loadSaved(resource));
  const [name, setName] = useState('');

  const set = (g: FilterGroup): void => {
    onChange(g);
  };

  const addRow = (): void => {
    if (value.items.length >= 20) return;
    set({ ...value, items: [...value.items, { field: fields[0]?.field ?? 'id', op: 'contains', value: '' } as FilterItem] });
  };

  const patch = (i: number, p: Partial<FilterItem>): void => {
    const items = value.items.map((x, j) => (i === j ? { ...x, ...p } : x));
    set({ ...value, items });
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex items-center gap-2">
        <FilterIcon size={14} className="text-[rgb(var(--c-primary))]" />
        <span className="text-[12px] font-bold uppercase tracking-wide text-[rgb(var(--c-muted))]">{t('filters.title')}</span>
        <button className={cn('btn btn-sm ms-auto', value.combinator === 'AND' ? 'btn-primary' : 'btn-ghost')} onClick={() => set({ ...value, combinator: value.combinator === 'AND' ? 'OR' : 'AND' })}>
          {value.combinator === 'AND' ? t('filters.and') : t('filters.or')}
        </button>
      </div>

      {value.items.length === 0 ? <p className="rounded-lg bg-[rgb(var(--c-surface-2))] px-2 py-1.5 text-[12px] text-[rgb(var(--c-muted))]">{t('filters.empty')}</p> : null}

      {value.items.map((f, i) => (
        <div key={i} className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-1.5">
          <Select
            className="!min-h-8 !py-1 text-[12.5px]"
            value={f.field}
            onChange={(e) => patch(i, { field: e.target.value, value: '' })}
            options={fields.map((x) => ({ value: x.field, label: x.label }))}
          />
          <Select className="!min-h-8 w-[74px] !py-1 font-mono text-[12.5px]" value={f.op} onChange={(e) => patch(i, { op: e.target.value as FilterItem['op'] })} options={OPS.map((o) => ({ value: o.v, label: o.label }))} />
          {f.op === 'between' ? (
            <div className="flex items-center gap-1">
              <Input className="!min-h-8 !py-1 text-[12.5px]" type="text" value={String(f.value ?? '')} onChange={(e) => patch(i, { value: e.target.value })} />
              <Input className="!min-h-8 !py-1 text-[12.5px]" type="text" value={String(f.value2 ?? '')} onChange={(e) => patch(i, { value2: e.target.value })} />
            </div>
          ) : f.op === 'empty' || f.op === 'notEmpty' ? (
            <span />
          ) : (() => {
            const fd = fields.find((x) => x.field === f.field);
            return fd?.kind === 'select' ? (
              <Select className="!min-h-8 !py-1 text-[12.5px]" value={String(f.value ?? '')} onChange={(e) => patch(i, { value: e.target.value })} options={[{ value: '', label: '—' }, ...(fd.options ?? []).map((o) => ({ value: String(o.value), label: o.label }))]} />
            ) : (
              <Input className="!min-h-8 !py-1 text-[12.5px]" type={fd?.kind === 'number' ? 'number' : fd?.kind === 'date' ? 'date' : 'text'} value={String(f.value ?? '')} onChange={(e) => patch(i, { value: e.target.value })} />
            );
          })()}
          <button className="btn btn-ghost btn-sm btn-icon" onClick={() => set({ ...value, items: value.items.filter((_, j) => j !== i) })} title={t('delete')}>
            <Trash2 size={13} className="text-[rgb(var(--c-coral))]" />
          </button>
        </div>
      ))}

      <div className="flex items-center gap-1.5">
        <Button size="sm" className="btn-ghost" onClick={addRow}>
          <Plus size={13} /> {t('filters.add')}
        </Button>
        {value.items.length ? (
          <Button size="sm" className="btn-ghost" onClick={() => set({ combinator: 'AND', items: [] })}>
            {t('filters.clear')}
          </Button>
        ) : null}
      </div>

      {saved.length ? (
        <div className="border-t border-[rgb(var(--c-line)/0.6)] pt-2">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase text-[rgb(var(--c-muted))]">
            <Bookmark size={12} /> {t('filters.saved')}
          </div>
          <div className="flex flex-wrap gap-1">
            {saved.map((s) => (
              <span key={s.name} className="badge">
                <button className="font-semibold" onClick={() => onChange(s.group)}>
                  {s.name}
                </button>
                <button
                  className="opacity-50 hover:opacity-100"
                  onClick={() => {
                    const next = saved.filter((x) => x.name !== s.name);
                    setSaved(next);
                    saveSaved(resource, next);
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {value.items.length ? (
        <div className="flex gap-1.5">
          <Input className="!min-h-8 !py-1 text-[12.5px]" placeholder={t('filters.saveName')} value={name} onChange={(e) => setName(e.target.value)} />
          <Button
            size="sm"
            className="btn-ghost"
            onClick={() => {
              if (!name.trim()) return;
              const next = [...saved.filter((x) => x.name !== name.trim()), { name: name.trim(), group: value }];
              setSaved(next);
              saveSaved(resource, next);
              setName('');
            }}
          >
            <Save size={13} />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function loadSaved(resource: string): SavedFilter[] {
  try {
    return JSON.parse(localStorage.getItem(`sardpi:filters:${resource}`) ?? '[]') as SavedFilter[];
  } catch {
    return [];
  }
}
function saveSaved(resource: string, x: SavedFilter[]): void {
  try {
    localStorage.setItem(`sardpi:filters:${resource}`, JSON.stringify(x));
  } catch {
    /* ignore */
  }
}
