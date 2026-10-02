'use client';
/**
 * Préférences d'affichage (formats de date configurés dans Réglages › Général) + aide libellés
 * d'étapes du suivi. Cache react-query (5 min) — la route /refs/display ne contient aucune donnée
 * personnelle, elle peut donc être mise en cache côté client sans risque.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface DisplayCfg {
  dateDisplay: string;
  timeDisplay: boolean;
  steps: { key: string; label: string }[];
}
const FALLBACK: DisplayCfg = { dateDisplay: 'DD/MM/YYYY', timeDisplay: true, steps: [] };

export function useDisplayCfg(): DisplayCfg {
  const q = useQuery({
    queryKey: ['refs', 'display'],
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    queryFn: () => api.get<DisplayCfg>('/refs/display'),
  });
  return q.data ?? FALLBACK;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** Vrai si la valeur est un horodatage ISO (date seule ou date+heure). */
export function looksLikeDate(v: unknown): boolean {
  return typeof v === 'string' && ISO_RE.test(v);
}

/**
 * Formatte une date ISO selon le motif des réglages. Aucune conversion de fuseau :
 * la valeur affichée reste celle encodée (cohérent avec l'encodage serveur en heures locales).
 */
export function fmtDisplay(v: unknown, cfg: DisplayCfg, dateOnly = false): string {
  if (v == null || v === '') return '';
  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return s;
  const [, Y, Mo, D, hh, mm] = m;
  let out = cfg.dateDisplay.replace('YYYY', Y ?? '').replace('MM', Mo ?? '').replace('DD', D ?? '');
  if (!dateOnly && cfg.timeDisplay && hh != null && mm != null) out += ` ${hh}:${mm}`;
  return out;
}

/** Accroche pratique : fmt(iso, dateOnly?) selon les réglages, utilisable dans n'importe quel composant. */
export function useFmtDate(): (v: unknown, dateOnly?: boolean) => string {
  const d = useDisplayCfg();
  return (v: unknown, dateOnly?: boolean): string => fmtDisplay(v, d, dateOnly);
}

/** Libellé localisé d'une étape du workflow (réglage workflowSteps via /refs/display). */
export function stepLabel(cfg: DisplayCfg, key: string | null | undefined): string {
  if (!key) return '—';
  return cfg.steps.find((s) => s.key === key)?.label ?? key;
}
