'use client';
/**
 * Chargeurs stylés — trois niveaux :
 *  1. SessionLoader : plein écran pendant la VÉRIFICATION de session (statut « checking »).
 *     Sans lui, un utilisateur reconnecté (cookie de refresh valide) voyait un écran vide,
 *     voire était expulsé vers /login avant la résolution de /auth/refresh.
 *  2. PageLoader : repli de route (loading.tsx) — barre de progression + squelette de page.
 *  3. InlineLoader / RowSkeletons : attentes locales courtes (panneaux, listes).
 * Toutes les animations sont pilotées par « .motion-on » : la préférence « animations réduites »
 * (et prefers-reduced-motion) les coupe automatiquement — 60 fps garanti sur petits postes.
 */
import React from 'react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** Logo animé partagé (anneau conique + respiration). */
function BrandMark({ size = 52 }: { size?: number }): React.ReactElement {
  return (
    <span className="loader-ring" style={{ width: size, height: size }}>
      <span
        className="loader-pulse grid place-items-center rounded-2xl bg-[rgb(var(--c-primary))] font-bold text-[rgb(var(--c-primary-ink))] shadow-[var(--shadow-glow)]"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.44) }}
      >
        S
      </span>
    </span>
  );
}

/**
 * Écran de vérification de session. `label` permet de réutiliser le même visuel pour d'autres
 * attentes bloquantes (bascule de langue, rechargement de licence…).
 */
export function SessionLoader({ label, hint }: { label?: string; hint?: string }): React.ReactElement {
  const { t } = useT('auth');
  const { t: tc } = useT('common');
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden p-4">
      {/* Fond vivant : mêmes sphères floues que l'écran de connexion (cohérence visuelle). */}
      <div className="bg-blob" style={{ insetBlockStart: '-12%', insetInlineStart: '-8%', width: 380, height: 380, background: 'rgb(var(--c-primary) / 0.35)' }} />
      <div className="bg-blob blob-2" style={{ insetBlockEnd: '-16%', insetInlineEnd: '-10%', width: 420, height: 420, background: 'rgb(var(--c-mint) / 0.3)' }} />

      <div className="glass-card relative z-10 flex w-full max-w-sm flex-col items-center gap-4 px-6 py-8 text-center">
        <BrandMark />
        <div className="flex flex-col gap-1">
          <p className="text-[15px] font-bold text-[rgb(var(--c-ink))]">{label ?? t('login.loading')}</p>
          <p className="text-[12.5px] text-[rgb(var(--c-muted))]">{hint ?? tc('loading.sessionHint')}</p>
        </div>
        <div className="loader-bar w-full" role="progressbar" aria-label={label ?? t('login.loading')} aria-valuetext={tc('loading.wait')} />
      </div>
    </div>
  );
}

/**
 * Repli de route (`loading.tsx`) : barre de progression en haut + squelette évoquant la mise en
 * page réelle (barre d'outils, filtres, lignes) pour éviter tout « saut » au chargement.
 */
export function PageLoader({ rows = 6, title = true }: { rows?: number; title?: boolean }): React.ReactElement {
  const { t } = useT('common');
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">{t('loading.page')}</span>
      <div className="loader-bar" />
      <div className="glass-card flex flex-col gap-3 !p-3">
        {title ? (
          <div className="flex flex-wrap items-center gap-2">
            <div className="skeleton h-6 w-52" />
            <div className="skeleton ms-auto h-8 w-28" />
            <div className="skeleton h-8 w-24" />
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <div className="skeleton h-9 min-w-[180px] flex-1" />
          <div className="skeleton h-9 w-32" />
          <div className="skeleton h-9 w-32" />
        </div>
        <RowSkeletons rows={rows} />
      </div>
    </div>
  );
}

/** Lignes de squelette en cascade (tableau ou liste de cartes). */
export function RowSkeletons({ rows = 5, height = 40, className }: { rows?: number; height?: number; className?: string }): React.ReactElement {
  return (
    <div className={cn('skeleton-stagger flex flex-col gap-1.5', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton w-full" style={{ height }} />
      ))}
    </div>
  );
}

/** Petit chargeur en ligne (bouton, panneau, cellule). */
export function InlineLoader({ label, className }: { label?: string; className?: string }): React.ReactElement {
  const { t } = useT('common');
  return (
    <span className={cn('inline-flex items-center gap-2 text-[12.5px] font-semibold text-[rgb(var(--c-muted))]', className)} role="status">
      <span className="loader-ring h-4 w-4">
        <span className="h-4 w-4 rounded-full bg-[rgb(var(--c-primary)/0.18)]" />
      </span>
      {label ?? t('loading.wait')}
    </span>
  );
}
