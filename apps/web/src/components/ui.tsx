'use client';
/** Primitives UI du design system (cartes glass, boutons, champs, badges, onglets, skeletons, tooltips). */
import React from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, children, soft, ...rest }: React.HTMLAttributes<HTMLDivElement> & { soft?: boolean }): React.ReactElement {
  return (
    <div className={cn(soft ? 'glass-soft' : 'glass-card', 'p-4', className)} {...rest}>
      {children}
    </div>
  );
}

type BtnVariant = 'primary' | 'ghost' | 'danger' | 'ok';
export function Button({
  variant = 'ghost',
  size,
  icon: Icon,
  className,
  children,
  loading,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md'; icon?: React.ComponentType<{ size?: number; className?: string }>; loading?: boolean }): React.ReactElement {
  return (
    <button type="button" className={cn('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', !children && 'btn-icon', className)} disabled={rest.disabled || loading} {...rest}>
      {loading ? <Spinner /> : Icon ? <Icon size={size === 'sm' ? 15 : 17} /> : null}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" className={cn('h-4 w-4 animate-spin', className)} fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Badge({ tone, children, className, title }: { tone?: 'ok' | 'warn' | 'danger' | 'info' | 'neutral'; children: React.ReactNode; className?: string; title?: string }): React.ReactElement {
  const tones: Record<string, string> = {
    ok: 'bg-[rgb(var(--c-ok-soft))] text-[rgb(var(--c-ok))] border-[rgb(var(--c-ok)/0.35)]',
    warn: 'bg-[rgb(var(--c-amber-soft))] text-[rgb(var(--c-amber))] border-[rgb(var(--c-amber)/0.35)]',
    danger: 'bg-[rgb(var(--c-coral-soft))] text-[rgb(var(--c-coral))] border-[rgb(var(--c-coral)/0.35)]',
    info: 'bg-[rgb(var(--c-info-soft))] text-[rgb(var(--c-info))] border-[rgb(var(--c-info)/0.35)]',
    neutral: 'bg-[rgb(var(--c-surface-2))] text-[rgb(var(--c-muted))]',
  };
  return <span className={cn('badge', tones[tone ?? 'neutral'], className)} title={title}>{children}</span>;
}

export function Field({
  label,
  error,
  hint,
  required,
  children,
  className,
}: {
  label?: React.ReactNode;
  error?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <label className={cn('block', className)}>
      {label ? (
        <span className="mb-1 block text-[12.5px] font-semibold text-[rgb(var(--c-ink)/0.8)]">
          {label}
          {required ? <span className="ms-1 text-[rgb(var(--c-coral))]">*</span> : null}
        </span>
      ) : null}
      {children}
      {error ? <span className="mt-1 block text-[12px] font-medium text-[rgb(var(--c-coral))]">{error}</span> : hint ? <span className="mt-1 block text-[12px] text-[rgb(var(--c-muted))]">{hint}</span> : null}
    </label>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ className, invalid, ...rest }, ref) {
  return <input ref={ref} className={cn('field', className)} aria-invalid={invalid || undefined} {...rest} />;
});

export function Textarea({ className, rows = 4, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>): React.ReactElement {
  return <textarea rows={rows} className={cn('field min-h-[90px]', className)} {...rest} />;
}

export function Select({ className, options, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] }): React.ReactElement {
  return (
    <select className={cn('field appearance-none pe-8 bg-[length:0]', className)} {...rest}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Checkbox({ className, label, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { label?: React.ReactNode }): React.ReactElement {
  return (
    <label className={cn('inline-flex min-h-[var(--row-h)] cursor-pointer select-none items-center gap-2 text-sm', className)}>
      <input type="checkbox" className="h-[17px] w-[17px] cursor-pointer accent-[rgb(var(--c-primary))]" {...rest} />
      {label}
    </label>
  );
}

export function Switch({ checked, onChange, disabled, className }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; className?: string }): React.ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn('relative h-6 w-11 shrink-0 cursor-pointer rounded-full border transition-colors', checked ? 'border-[rgb(var(--c-primary))] bg-[rgb(var(--c-primary))]' : 'border-[rgb(var(--c-line))] bg-[rgb(var(--c-surface-2))]', className)}
    >
      <span className={cn('absolute top-[3px] block h-4 w-4 rounded-full bg-white shadow transition-all', checked ? 'ltr:left-[25px] rtl:right-[25px]' : 'ltr:left-[3px] rtl:right-[3px]')} />
    </button>
  );
}

export function Tabs({ tabs, active, onChange, className }: { tabs: { key: string; label: React.ReactNode; badge?: number }[]; active: string; onChange: (k: string) => void; className?: string }): React.ReactElement {
  return (
    <div role="tablist" className={cn('flex min-w-0 gap-1 overflow-x-auto rounded-xl border border-[rgb(var(--c-line)/0.7)] bg-[rgb(var(--c-surface)/0.6)] p-1', className)}>
      {tabs.map((tb) => (
        <button
          key={tb.key}
          role="tab"
          aria-selected={active === tb.key}
          onClick={() => onChange(tb.key)}
          className={cn(
            'flex min-h-9 shrink-0 items-center gap-1.5 rounded-[9px] px-3 text-[13px] font-semibold transition-all',
            active === tb.key ? 'bg-[rgb(var(--c-primary))] text-[rgb(var(--c-primary-ink))] shadow' : 'text-[rgb(var(--c-muted))] hover:bg-[rgb(var(--c-surface-2))]',
          )}
        >
          {tb.label}
          {tb.badge !== undefined && tb.badge > 0 ? <span className="rounded-full bg-black/10 px-1.5 text-[10px]">{tb.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }): React.ReactElement {
  return <div className={cn('skeleton h-4 w-full', className)} />;
}

export function EmptyState({ icon: Icon, title, hint, action }: { icon?: React.ComponentType<{ size?: number; className?: string }>; title: string; hint?: string; action?: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      {Icon ? <Icon size={34} className="mb-1 text-[rgb(var(--c-muted)/0.6)]" /> : null}
      <p className="text-sm font-semibold">{title}</p>
      {hint ? <p className="max-w-sm text-[12.5px] text-[rgb(var(--c-muted))]">{hint}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** Info-bulle légère (title attribute = pas de portail, zéro perf cost) — suffisante et accessible. */
export function Tip({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return <span title={label}>{children}</span>;
}
