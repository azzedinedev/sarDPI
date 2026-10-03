'use client';

/**
 * RecordFields — affiche/édite les valeurs d'une fiche (fields_json) à partir de la
 * configuration de champs du type d'intervention (intervention_types.fields_json).
 * JAMAIS de JSON brut : en lecture → libellé : valeur ; en édition → un champ par clé
 * (typé selon `kind`) + champs personnalisés clé→valeur ajoutables/supprimables.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { pickLabel } from '@sardpi/shared';
import { Button, Input, Select, Textarea } from '@/components/ui';

export interface FieldConfig {
  key: string;
  kind?: string;
  label?: Record<string, string> | string;
  unit?: string;
  required?: boolean;
  options?: string[] | { value: string; label: string }[];
}

type Vals = Record<string, string | number | boolean | null | undefined>;

function labelOf(c: { key: string; label?: Record<string, string> | string }, lang: string): string {
  if (typeof c.label === 'string' && c.label) return c.label;
  if (c.label && typeof c.label === 'object') return pickLabel(c.label as never, lang as never) || c.key;
  return c.key;
}

function normOptions(o: FieldConfig['options']): { value: string; label: string }[] {
  if (!Array.isArray(o)) return [];
  return o.map((x) => (typeof x === 'string' ? { value: x, label: x } : { value: String(x.value), label: x.label ?? String(x.value) }));
}

function displayValue(v: unknown): string {
  if (v == null || v === '') return '';
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  return String(v);
}

export function RecordFields({
  config,
  value,
  onChange,
  mode = 'read',
  lang = 'fr',
  emptyLabel = '—',
}: {
  config: FieldConfig[];
  value: Vals | null | undefined;
  onChange?: (v: Vals) => void;
  mode?: 'read' | 'edit';
  lang?: string;
  emptyLabel?: string;
}): React.ReactElement {
  const vals: Vals = useMemo(() => ({ ...(value ?? {}) }), [value]);
  const cfgKeys = useMemo(() => new Set(config.map((c) => c.key)), [config]);

  // ---- champs personnalisés (clés présentes dans les valeurs mais absentes de la config) ----
  const [extra, setExtra] = useState<{ id: number; key: string }[]>(() =>
    Object.keys(vals)
      .filter((k) => !cfgKeys.has(k))
      .map((k, i) => ({ id: i + 1, key: k })),
  );

  // Quand les valeurs changent (chargement asynchrone d'une fiche, changement d'enregistrement),
  // ajoute aux champs personnalisés toute clé non-config présente dans `value` — sans retirer
  // ceux que l'utilisateur est en train de saisir. Retourne `prev` (identité stable) si rien
  // d'entrant → pas de re-rendu inutile.
  useEffect(() => {
    setExtra((prev) => {
      const have = new Set(prev.map((x) => x.key));
      const incoming = Object.keys(vals).filter((k) => !cfgKeys.has(k) && !have.has(k));
      if (!incoming.length) return prev;
      let maxId = prev.reduce((m, x) => Math.max(m, x.id), 0);
      return [...prev, ...incoming.map((k) => ({ id: (maxId += 1), key: k }))];
    });
  }, [vals, cfgKeys]);

  const emit = (next: Vals): void => {
    onChange?.(next);
  };
  const setField = (k: string, v: string | number | boolean | null): void => {
    emit({ ...vals, [k]: v });
  };
  const addExtra = (): void => {
    let base = 'champ';
    let n = 1;
    let key = `${base}_${n}`;
    while (key in vals || cfgKeys.has(key)) {
      n += 1;
      key = `${base}_${n}`;
    }
    setExtra((e) => [...e, { id: Date.now(), key }]);
    emit({ ...vals, [key]: '' });
  };
  const removeExtra = (key: string): void => {
    setExtra((e) => e.filter((x) => x.key !== key));
    const next = { ...vals };
    delete next[key];
    emit(next);
  };
  const renameExtra = (oldKey: string, newKey: string, id: number): void => {
    setExtra((e) => e.map((x) => (x.id === id ? { ...x, key: newKey } : x)));
    const next = { ...vals };
    const v = next[oldKey];
    delete next[oldKey];
    if (newKey) next[newKey] = v ?? '';
    emit(next);
  };

  /* ---------------------------------------------------------- lecture */
  if (mode === 'read') {
    const cfgRows = config.filter((c) => displayValue(vals[c.key]) !== '');
    // clés personnalisées dérivées directement des valeurs → toujours exact, même si le
    // composant est réutilisé pour une autre fiche (pas de dépendance à l'état local `extra`).
    const extraKeys = Object.keys(vals).filter((k) => !cfgKeys.has(k) && displayValue(vals[k]) !== '');
    if (!cfgRows.length && !extraKeys.length) {
      return <p className="text-[12.5px] text-[rgb(var(--c-muted))]">{emptyLabel}</p>;
    }
    return (
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {[...cfgRows.map((c) => ({ k: c.key, label: labelOf(c, lang), unit: c.unit, v: vals[c.key] })), ...extraKeys.map((k) => ({ k, label: k, unit: undefined, v: vals[k] }))].map((row) => (
          <div key={row.k} className="flex items-baseline justify-between gap-3 border-b border-[rgb(var(--c-line)/0.5)] py-1 last:border-0">
            <dt className="shrink-0 text-[12px] font-semibold text-[rgb(var(--c-muted))]">{row.label}</dt>
            <dd className="min-w-0 flex-1 text-end text-[13px] font-medium break-words">
              {displayValue(row.v)}
              {row.unit ? <span className="ms-1 text-[11px] text-[rgb(var(--c-muted))]">{row.unit}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  /* ---------------------------------------------------------- édition */
  const renderInput = (c: FieldConfig): React.ReactElement => {
    const kind = (c.kind ?? 'text').toLowerCase();
    const v = vals[c.key];
    if (kind === 'textarea') return <Textarea rows={2} value={displayValue(v)} onChange={(e) => setField(c.key, e.target.value)} />;
    if (kind === 'number') return <Input type="number" dir="ltr" value={v == null ? '' : String(v)} onChange={(e) => setField(c.key, e.target.value === '' ? null : Number(e.target.value))} />;
    if (kind === 'select') return <Select value={displayValue(v)} onChange={(e) => setField(c.key, e.target.value)} options={[{ value: '', label: '—' }, ...normOptions(c.options)]} />;
    if (kind === 'date') return <Input type="date" dir="ltr" value={displayValue(v)} onChange={(e) => setField(c.key, e.target.value)} />;
    return <Input type="text" value={displayValue(v)} onChange={(e) => setField(c.key, e.target.value)} />;
  };

  return (
    <div className="flex flex-col gap-3">
      {config.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {config.map((c) => (
            <label key={c.key} className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-[rgb(var(--c-muted))]">
                {labelOf(c, lang)}
                {c.required ? <span className="ms-0.5 text-[rgb(var(--c-coral))]">*</span> : null}
                {c.unit ? <span className="ms-1 text-[11px] font-normal">({c.unit})</span> : null}
              </span>
              {renderInput(c)}
            </label>
          ))}
        </div>
      ) : null}

      {/* champs personnalisés clé → valeur */}
      <div className="flex flex-col gap-2">
        {extra.map((x) => (
          <div key={x.id} className="flex items-center gap-2">
            <Input
              className="max-w-[40%]"
              value={x.key}
              placeholder="clé"
              onChange={(e) => renameExtra(x.key, e.target.value, x.id)}
            />
            <span className="text-[rgb(var(--c-muted))]">→</span>
            <Input
              className="flex-1"
              value={displayValue(vals[x.key])}
              placeholder="valeur"
              onChange={(e) => setField(x.key, e.target.value)}
            />
            <Button size="sm" variant="ghost" title="Supprimer" onClick={() => removeExtra(x.key)}>
              <Trash2 size={15} className="text-[rgb(var(--c-coral))]" />
            </Button>
          </div>
        ))}
        <div>
          <Button size="sm" variant="ghost" onClick={addExtra}>
            <Plus size={15} /> Ajouter un champ
          </Button>
        </div>
      </div>
    </div>
  );
}
