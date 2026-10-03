'use client';
/**
 * RichEditor — éditeur HTML minimal (gras / italique / souligné / listes), branché sur
 * react-hook-form via un champ caché (name). Aucune dépendance externe ; le contenu est
 * assaini à chaque frappe (whitelist de balises, zéro attribut) — la même fonction sert
 * côté serveur à l'enregistrement (défense en profondeur, loi 18-07 : pas de HTML hostile en base).
 */
import React, { useEffect, useRef } from 'react';
import { useFormContext } from 'react-hook-form';
import { Bold, Italic, List, ListOrdered, Underline, Eraser } from 'lucide-react';
import { sanitizeRichHtml } from '@sardpi/shared';
import { cn } from '@/lib/utils';

const BTNS: [string, React.ComponentType<{ size?: number }>, string][] = [
  ['bold', Bold, 'B'],
  ['italic', Italic, 'I'],
  ['underline', Underline, 'U'],
  ['insertUnorderedList', List, '•—'],
  ['insertOrderedList', ListOrdered, '1.—'],
  ['removeFormat', Eraser, '⌫'],
];

export function RichEditor({ name, disabled, className }: { name: string; disabled?: boolean; className?: string }): React.ReactElement {
  const { watch, setValue, register } = useFormContext<Record<string, unknown>>();
  const ref = useRef<HTMLDivElement>(null);
  const value = String(watch(name) ?? '');

  // synchronise l'éditeur quand la valeur vient d'ailleurs (reset au passage en édition, données legacy)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (sanitizeRichHtml(el.innerHTML) !== sanitizeRichHtml(value)) el.innerHTML = sanitizeRichHtml(value);
  }, [value]);

  const emit = (): void => {
    if (!ref.current) return;
    setValue(name, sanitizeRichHtml(ref.current.innerHTML), { shouldDirty: true });
  };

  const exec = (cmd: string): void => {
    ref.current?.focus();
    document.execCommand(cmd);
    emit();
  };

  return (
    <div className={cn('field !p-0 focus-within:!border-[rgb(var(--c-primary))] overflow-hidden', disabled && 'pointer-events-none opacity-60', className)}>
      <div className="flex flex-wrap items-center gap-0.5 border-b border-[rgb(var(--c-line)/0.7)] bg-[rgb(var(--c-surface-2)/0.55)] px-1 py-0.5" role="toolbar" aria-label="format">
        {BTNS.map(([cmd, Ic, title]) => (
          <button key={cmd} type="button" title={title} onMouseDown={(e) => { e.preventDefault(); exec(cmd); }} className="grid h-7 w-7 place-items-center rounded-md text-[rgb(var(--c-muted))] transition-colors hover:bg-[rgb(var(--c-surface))] hover:text-[rgb(var(--c-ink))]">
            <Ic size={14} />
          </button>
        ))}
      </div>
      <div
        ref={ref}
        className="richtext min-h-[92px] max-h-72 overflow-y-auto px-3 py-2 outline-none"
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={emit}
        onBlur={emit}
        data-placeholder=""
        role="textbox"
        aria-multiline="true"
      />
      <input type="hidden" {...register(name)} />
    </div>
  );
}
