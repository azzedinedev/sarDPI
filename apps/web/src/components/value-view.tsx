'use client';
/**
 * Rendu lisible des valeurs structurées — plus jamais de JSON brut à l'écran.
 * ---------------------------------------------------------------------------
 * Les fiches (consultation, labo, radio…) stockent leurs réponses en JSONB : objets, tableaux,
 * libellés multilingues. Auparavant ces valeurs étaient affichées telles quelles
 * (`JSON.stringify`) ou, pire, en `String(objet)` → « [object Object] ».
 *
 * Ce module propose deux sorties cohérentes :
 *  - humanize() : chaîne lisible (infobulles, exports CSV, presse-papier, titres) ;
 *  - ValueView  : rendu React structuré — libellé traduit, puces, liste clé→valeur ou tableau.
 * Les libellés multilingues ({fr,ar,es,en}) passent par pickLabel() : la langue active décide.
 * Profondeur et nombre d'éléments bornés (une valeur pathologique ne peut pas casser la mise
 * en page ni coûter 60 fps).
 */
import React from 'react';
import { pickLabel } from '@sardpi/shared';
import { activeLang } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** Langues de l'application — sert à reconnaître un objet « libellé multilingue ». */
const LANG_KEYS = ['fr', 'ar', 'es', 'en'];
/** Profondeur maximale de rendu imbriqué (au-delà : résumé textuel). */
const MAX_DEPTH = 3;
/** Nombre maximal de lignes d'un tableau de valeurs. */
const MAX_ROWS = 12;
/** Nombre maximal d'éléments d'une liste de puces. */
const MAX_CHIPS = 10;

/* La langue de repli vient du fournisseur i18n (activeLang()) : les appelants hors composant —
   exports CSV, infobulles, utilitaires — obtiennent ainsi la langue réellement active, sans quoi
   les libellés multilingues stockés en base s'afficheraient en français pour un arabophone. */

/** Vrai si la valeur est un libellé multilingue : objet plat dont les clés sont des langues. */
export function isLabelObject(v: unknown): v is Record<string, string> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length === 0) return false;
  // Toutes les clés sont des codes de langue connus et toutes les valeurs sont des chaînes.
  return entries.every(([k, val]) => LANG_KEYS.includes(k) && typeof val === 'string');
}

function isScalar(v: unknown): boolean {
  return v === null || v === undefined || typeof v !== 'object';
}

/** Formate une clé technique en libellé lisible : « systolic_bp » → « Systolic bp ». */
export function humanKey(key: string): string {
  const s = key.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : key;
}

/**
 * Chaîne lisible pour n'importe quelle valeur. Ne renvoie jamais « [object Object] » ni un bloc
 * JSON : objets et tableaux sont résumés (paires clé: valeur, ou « N éléments » au-delà).
 */
export function humanize(v: unknown, lang: string = activeLang(), depth = 0): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v;
  if (depth >= MAX_DEPTH) return Array.isArray(v) ? `${v.length} …` : '…';

  if (isLabelObject(v)) return pickLabel(v as never, lang as never) || '';

  if (Array.isArray(v)) {
    if (v.length === 0) return '';
    if (v.every(isScalar)) return v.map((x) => humanize(x, lang, depth + 1)).filter(Boolean).join(' · ');
    // Tableau d'objets : on résume le premier élément puis « +N » — forme neutre en langue
    // (ni mot traduit codé en dur, ni crochets JSON). Le rendu structuré, lui, fait un tableau.
    const first = humanize(v[0], lang, depth + 1);
    return v.length > 1 ? `${first} · +${v.length - 1}` : first;
  }

  const entries = Object.entries(v as Record<string, unknown>).filter(([, val]) => val !== null && val !== undefined && val !== '');
  if (entries.length === 0) return '';
  const pairs = entries.slice(0, 4).map(([k, val]) => `${humanKey(k)}: ${humanize(val, lang, depth + 1)}`);
  return entries.length > 4 ? `${pairs.join(' · ')} · +${entries.length - 4}` : pairs.join(' · ');
}

/**
 * Rendu structuré d'une valeur. Les scalaires sont rendus tels quels ; les objets deviennent une
 * liste clé→valeur ; les tableaux d'objets deviennent un tableau ; les tableaux de scalaires une
 * ligne de puces.
 */
export function ValueView({
  value,
  lang,
  depth = 0,
  className,
}: {
  value: unknown;
  /** Langue d'affichage ; à défaut, la langue active de l'application. */
  lang?: string;
  depth?: number;
  className?: string;
}): React.ReactElement {
  const lng = lang ?? activeLang();
  // Vide — tiret cadratin discret, cohérent avec le reste des tableaux de l'application.
  if (value === null || value === undefined || value === '') return <span className={cn('text-[rgb(var(--c-muted)/0.55)]', className)}>—</span>;
  if (typeof value === 'boolean') return <span className={cn(value ? 'font-bold text-[rgb(var(--c-ok))]' : 'text-[rgb(var(--c-muted))]', className)}>{value ? '✓' : '✗'}</span>;
  if (typeof value !== 'object') return <span className={className}>{String(value)}</span>;

  if (depth >= MAX_DEPTH) return <span className={cn('text-[12px] text-[rgb(var(--c-muted))]', className)}>{humanize(value, lng, depth)}</span>;

  if (isLabelObject(value)) {
    const label = pickLabel(value as never, lng as never);
    return <span className={className}>{label || '—'}</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className={cn('text-[rgb(var(--c-muted)/0.55)]', className)}>—</span>;

    // Tableau de scalaires (ou de libellés) → puces compactes, jamais de crochets/JSON.
    if (value.every((x) => isScalar(x) || isLabelObject(x))) {
      const shown = value.slice(0, MAX_CHIPS);
      const rest = value.length - shown.length;
      return (
        <span className={cn('flex flex-wrap items-center gap-1', className)}>
          {shown.map((x, i) => (
            <span key={i} className="badge">
              {humanize(x, lng, depth + 1)}
            </span>
          ))}
          {rest > 0 ? <span className="text-[11.5px] font-semibold text-[rgb(var(--c-muted))]">+{rest}</span> : null}
        </span>
      );
    }

    // Tableau d'objets → vrai tableau : colonnes = union des clés rencontrées (bornée).
    const cols: string[] = [];
    for (const row of value) {
      if (row && typeof row === 'object' && !Array.isArray(row)) {
        for (const k of Object.keys(row as Record<string, unknown>)) if (!cols.includes(k)) cols.push(k);
      }
      if (cols.length >= 8) break;
    }
    const rows = value.slice(0, MAX_ROWS);
    if (cols.length === 0) return <span className={cn('text-[12px] text-[rgb(var(--c-muted))]', className)}>{humanize(value, lng, depth)}</span>;
    return (
      <span className={cn('block overflow-x-auto', className)}>
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c} className="border-b border-[rgb(var(--c-line))] bg-[rgb(var(--c-surface-2)/0.8)] px-2 py-1 text-start text-[11px] font-bold uppercase tracking-wide text-[rgb(var(--c-muted))]">
                  {humanKey(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="align-top odd:bg-[rgb(var(--c-surface)/0.5)]">
                {cols.map((c) => (
                  <td key={c} className="border-b border-[rgb(var(--c-line)/0.5)] px-2 py-1">
                    <ValueView value={(row as Record<string, unknown>)?.[c]} lang={lng} depth={depth + 1} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {value.length > MAX_ROWS ? (
          <span className="mt-1 block text-[11.5px] font-semibold text-[rgb(var(--c-muted))]">+{value.length - MAX_ROWS}</span>
        ) : null}
      </span>
    );
  }

  // Objet simple → liste de définitions clé→valeur (2 colonnes en largeur suffisante).
  const entries = Object.entries(value as Record<string, unknown>).filter(([, val]) => val !== null && val !== undefined && val !== '');
  if (entries.length === 0) return <span className={cn('text-[rgb(var(--c-muted)/0.55)]', className)}>—</span>;
  return (
    <dl className={cn('grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-[minmax(7rem,auto)_1fr]', className)}>
      {entries.map(([k, val]) => (
        <React.Fragment key={k}>
          <dt className="text-[11.5px] font-bold uppercase tracking-wide text-[rgb(var(--c-muted))]">{humanKey(k)}</dt>
          <dd className="min-w-0 text-[12.5px]">
            <ValueView value={val} lang={lng} depth={depth + 1} />
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
