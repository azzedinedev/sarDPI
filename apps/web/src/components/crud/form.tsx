'use client';
/** Formulaire générique du CrudModule (drawer créer/éditer) — react-hook-form + zodResolver optionnel. */
import React, { useEffect } from 'react';
import { useForm, FormProvider, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Drawer } from '@/components/dialogs';
import { Button, Checkbox, Field, Input, Select, Textarea } from '@/components/ui';
import { RichEditor } from '@/components/rich-editor';
import { richListFromLines } from '@sardpi/shared';
import { useT } from '@/lib/i18n';
import type { FieldDef, RowData } from './types';

const snake = (k: string): string => k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);

function lookup(row: RowData, key: string): unknown {
  if (row[key] !== undefined) return row[key];
  if (row[snake(key)] !== undefined) return row[snake(key)];
  if (key.includes('.')) {
    const [head, ...rest] = key.split('.');
    let cur: unknown = row[head!] ?? row[snake(head!)];
    for (const seg of rest) {
      if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[seg];
      else return null;
    }
    return cur;
  }
  // tentative : préfixe camelCase → colonne snake_case globale (name → name_json etc.)
  for (const [k, v] of Object.entries(row)) {
    if (k.endsWith('_json') && v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const base = snake(key);
      for (const kk of Object.keys(o)) {
        if (k.startsWith(base.slice(0, 4)) && kk === base) return o[kk];
      }
    }
  }
  return null;
}

export function initValue(fields: FieldDef[], row: RowData | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = row ? (lookup(row, f.key) ?? null) : null;
    if (f.kind === 'date' || f.kind === 'datetime') {
      const v = raw as string | Date | null;
      out[f.key] = v ? (typeof v === 'string' ? v.slice(0, f.kind === 'date' ? 10 : 16) : new Date(v).toISOString().slice(0, f.kind === 'date' ? 10 : 16)) : '';
    } else if (f.kind === 'checkbox') out[f.key] = Boolean(raw);
    else if (f.kind === 'number') out[f.key] = raw === null || raw === '' ? '' : Number(raw);
    else if (f.kind === 'richtext') out[f.key] = typeof raw === 'string' ? raw : Array.isArray(raw) ? richListFromLines(raw.map(String)) : raw == null ? '' : JSON.stringify(raw, null, 2);
    else if (f.kind === 'json') out[f.key] = typeof raw === 'string' ? raw : raw === null || raw === undefined ? '' : JSON.stringify(raw, null, 2);
    else if (f.kind === 'multiselect' || Array.isArray(raw)) out[f.key] = Array.isArray(raw) ? raw.join(', ') : (raw ?? '');
    else out[f.key] = raw ?? (f.kind === 'select' && f.options?.length ? '' : '');
  }
  return out;
}

export function CrudForm({
  open,
  onClose,
  title,
  fields,
  row,
  schema,
  onSubmit,
  busy,
  footerExtra,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  fields: FieldDef[];
  row: RowData | null;
  schema?: import('zod').ZodTypeAny;
  onSubmit: (values: Record<string, unknown>) => void;
  busy?: boolean;
  footerExtra?: React.ReactNode;
}): React.ReactElement {
  const { t } = useT('common');
  const methods = useForm<Record<string, unknown>>({
    resolver: schema ? (zodResolver(schema as never) as never) : undefined,
    defaultValues: initValue(fields, row),
  });
  const { register, handleSubmit, formState } = methods;

  useEffect(() => {
    if (open) methods.reset(initValue(fields, row));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row]);

  const submit: SubmitHandler<Record<string, unknown>> = (values) => {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v === '') {
        const f = fields.find((x) => x.key === k);
        if (f && (f.kind === 'number' || f.kind === 'date' || f.kind === 'datetime' || f.kind === 'time' || f.kind === 'json' || f.kind === 'richtext' || f.kind === 'multiselect')) {
          clean[k] = null;
          continue;
        }
        clean[k] = '';
        continue;
      }
      clean[k] = v;
    }
    onSubmit(clean);
  };

  return (
    <Drawer open={open} onClose={onClose} title={title} subtitle={row?.code ? <span dir="ltr" className="font-mono text-[13px]">{row.code as string}</span> : undefined} width="max-w-3xl">
      <FormProvider {...methods}>
        <form id="crud-form" onSubmit={handleSubmit(submit)} className="grid grid-cols-2 gap-x-4 gap-y-3.5">
          {groupFields(fields).map((grp, gi) =>
            grp.label == null ? (
              <React.Fragment key={`g${gi}`}>
                {grp.items.map((f) => (
                  <FieldShell key={f.key} f={f} error={formState.errors[f.key]?.message as string | undefined}>{renderInput(f, register)}</FieldShell>
                ))}
              </React.Fragment>
            ) : (
              <fieldset key={`g${gi}`} className="col-span-2 mt-1 border-t border-[rgb(var(--c-line)/0.7)] pt-3 first:border-t-0 first:pt-0">
                {grp.items.length < 2 ? grp.items.map((f) => (
                  <FieldShell key={f.key} f={f} error={formState.errors[f.key]?.message as string | undefined}>{renderInput(f, register)}</FieldShell>
                )) : (
                  <>
                    <legend className="pe-2 text-[13px] font-bold uppercase tracking-wide text-[rgb(var(--c-primary))]">{grp.label}</legend>
                    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3.5">
                      {grp.items.map((f) => (
                        <FieldShell key={f.key} f={f} error={formState.errors[f.key]?.message as string | undefined}>{renderInput(f, register)}</FieldShell>
                      ))}
                    </div>
                  </>
                )}
              </fieldset>
            ),
          )}
        </form>
      </FormProvider>
      <div className="mt-4 flex justify-end gap-2 border-t border-[rgb(var(--c-line)/0.6)] pt-3">
        {footerExtra}
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button variant="primary" type="submit" form="crud-form" loading={busy}>
          {t('save')}
        </Button>
      </div>
    </Drawer>
  );
}

/** Regroupe les champs par `group` consécutif (un champ seul dans un groupe = pas de légende inutile). */
function groupFields(fields: FieldDef[]): { label: FieldDef['group']; items: FieldDef[] }[] {
  const gs: { label: FieldDef['group']; items: FieldDef[] }[] = [];
  for (const f of fields) {
    const last = gs[gs.length - 1];
    if (f.group != null && last && last.label === f.group) last.items.push(f);
    else gs.push({ label: f.group ?? null, items: [f] });
  }
  return gs;
}

function FieldShell({ f, error, children }: { f: FieldDef; error?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className={f.colSpan === 2 ? 'col-span-2' : 'col-span-2 max-md:col-span-2 md:col-span-1'}>
      {f.kind === 'checkbox' ? <div className="pt-6">{children}</div> : <Field label={f.label ?? f.key} required={f.required} hint={f.hint} error={error}>{children}</Field>}
    </div>
  );
}

function renderInput(f: FieldDef, register: ReturnType<typeof useForm>['register']): React.ReactElement {
  switch (f.kind) {
    case 'textarea':
    case 'json':
      return <Textarea {...register(f.key)} rows={f.kind === 'json' ? 8 : 4} placeholder={f.placeholder} disabled={f.disabled} className={f.kind === 'json' ? 'font-mono text-[12.5px]' : undefined} />;
    case 'richtext':
      return <RichEditor name={f.key} disabled={f.disabled} />;
    case 'select':
      return (
        <Select {...register(f.key)} disabled={f.disabled} options={[{ value: '', label: '—' }, ...(f.options ?? []).map((o) => ({ value: String(o.value), label: o.label }))]} />
      );
    case 'checkbox':
      return <Checkbox label={f.label ?? f.key} {...register(f.key)} />;
    case 'multiselect':
      return <Input {...register(f.key)} placeholder={f.placeholder ?? (f.options ?? []).map((o) => o.label).join(', ')} disabled={f.disabled} />;
    case 'code':
      return <Input readOnly disabled {...register(f.key)} className="font-mono" />;
    default:
      return <Input type={f.kind === 'number' ? 'number' : f.kind === 'date' || f.kind === 'datetime' || f.kind === 'time' ? f.kind : f.kind === 'tel' ? 'tel' : f.kind === 'email' ? 'email' : f.kind === 'password' ? 'password' : 'text'} step={f.step ?? (f.kind === 'number' ? 'any' : undefined)} min={f.min} max={f.max} placeholder={f.placeholder} disabled={f.disabled} {...register(f.key)} />;
  }
}
