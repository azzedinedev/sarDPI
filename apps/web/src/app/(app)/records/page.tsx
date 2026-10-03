'use client';
/**
 * Hub « Documents médicaux » : une carte par catégorie d’intervention (LAB, PHA, DIA, CAR, RAD, …)
 * — les catégories sont DES DONNÉES (admin > catalogue), pas du code : cette page s’adapte seule.
 */
import React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Badge, Skeleton } from '@/components/ui';
import { CAT_ICON } from '@/components/icons';
import { useAuth } from '@/stores/auth';
import { pickLabel } from '@sardpi/shared';

interface Cat {
  id: number;
  module: string;
  prefix: string;
  label_json: Record<string, string>;
  color: string | null;
  icon: string | null;
  active: number | boolean;
  count?: number;
}

export default function RecordsHubPage(): React.ReactElement {
  const { t } = useT('common');
  const { lang } = useT('patient');
  const has = useAuth((s) => s.has);
  const q = useQuery({ queryKey: ['catalog'], queryFn: () => api.get<{ categories: Cat[] }>('/refs/catalog') });
  if (q.isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    );
  }
  const cats = (q.data?.categories ?? []).filter((c) => Boolean(Number(c.active)) && has(c.module, 'view'));
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[20px] font-bold">{t('nav.records')}</h1>
        <p className="text-[12.5px] text-[rgb(var(--c-muted))]">{t('records.hint')}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cats.map((c, i) => {
          const Icon = CAT_ICON[c.prefix] ?? CAT_ICON.CON!;
          return (
            <motion.div key={c.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.035, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
              <Link href={`/records/${c.module}`} className="glass-card list-card flex items-center gap-3.5 p-4">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white shadow-[var(--shadow-glow)]" style={{ background: c.color ?? 'rgb(var(--c-primary))' }}>
                  <Icon size={22} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-bold">{pickLabel(c.label_json, lang)}</span>
                  <span className="mt-0.5 block text-[11.5px] text-[rgb(var(--c-muted))]">
                    {c.prefix} · {t(`records.perms.${c.module}`) === `records.perms.${c.module}` ? c.module : t(`records.perms.${c.module}`)}
                  </span>
                </span>
                <Badge tone="info">{c.prefix}</Badge>
              </Link>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
