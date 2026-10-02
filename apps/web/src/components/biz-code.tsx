'use client';
/**
 * Code métier — TOUJOURS LTR même en RTL (§5), avec option de copie.
 * Infobulle automatique : le préfixe (LAB, CAR, ORD, MOV…) est traduit via /refs/prefixes
 * (catégories d'intervention + types GED/praticiens + libellés système) — l'utilisateur n'a
 * jamais à deviner à quoi correspond un code. Un `title` explicite prend la priorité.
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export function usePrefixLabels(): Record<string, string> {
  const i18n = useI18n();
  const q = useQuery({
    queryKey: ['refs', 'prefixes', i18n.lang],
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: false,
    queryFn: () => api.get<{ prefixes: Record<string, string> }>('/refs/prefixes').then((r) => r.prefixes ?? {}),
  });
  return q.data ?? {};
}

export function BizCode({ code, onClick, className, copy, title }: { code?: string | null; onClick?: () => void; className?: string; copy?: boolean; title?: string }): React.ReactElement | null {
  const [ok, setOk] = useState(false);
  const prefixes = usePrefixLabels();
  if (!code) return null;
  const pre = String(code).split('-')[0] ?? '';
  const mapped = prefixes[pre?.toUpperCase()];
  const tip = title ?? (mapped ? `${pre} — ${mapped}` : undefined);
  return (
    <span
      dir="ltr"
      className={cn('biz-code inline-flex cursor-default items-center gap-1 rounded-md bg-[rgb(var(--c-primary-soft)/0.6)] px-1.5 py-0.5 font-mono text-[12px] font-medium text-[rgb(var(--c-ink)/0.85)]', onClick && 'cursor-pointer hover:bg-[rgb(var(--c-primary-soft))]', className)}
      onClick={onClick}
      title={tip ? (copy ? `${tip} — copier` : tip) : copy ? 'copier' : undefined}
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
