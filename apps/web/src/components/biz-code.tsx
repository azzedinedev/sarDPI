'use client';
/** Code métier — TOUJOURS LTR même en RTL (§5), avec option de copie. */
import React, { useState } from 'react';
import { cn } from '@/lib/utils';

export function BizCode({ code, onClick, className, copy }: { code?: string | null; onClick?: () => void; className?: string; copy?: boolean }): React.ReactElement | null {
  const [ok, setOk] = useState(false);
  if (!code) return null;
  return (
    <span
      dir="ltr"
      className={cn('biz-code inline-flex cursor-default items-center gap-1 rounded-md bg-[rgb(var(--c-primary-soft)/0.6)] px-1.5 py-0.5 font-mono text-[12px] font-medium text-[rgb(var(--c-ink)/0.85)]', onClick && 'cursor-pointer hover:bg-[rgb(var(--c-primary-soft))]', className)}
      onClick={onClick}
      title={copy ? 'copier' : undefined}
    >
      {code}
      {copy ? (
        <button
          className="opacity-50 hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            void navigator.clipboard.writeText(code);
            setOk(true);
            setTimeout(() => setOk(false), 1200);
          }}
        >
          {ok ? '✓' : '⧉'}
        </button>
      ) : null}
    </span>
  );
}
