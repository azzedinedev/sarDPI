'use client';
/**
 * Préférences d'affichage (formats de date configurés dans Réglages › Général) + aide libellés
 * d'étapes du suivi. Cache react-query (5 min) — la route /refs/display ne contient aucune donnée
 * personnelle, elle peut donc être mise en cache côté client sans risque.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** Type de rendez-vous configurable (libellé déjà localisé par /refs/display). */
export interface CalKind {
  key: string;
  label: string;
  color: string;
  durationMin: number;
}
/** Statut de rendez-vous configurable. */
export interface CalStatus {
  key: string;
  label: string;
  color: string;
}

export interface DisplayCfg {
  dateDisplay: string;
  timeDisplay: boolean;
  steps: { key: string; label: string }[];
  calendarKinds?: { kinds: CalKind[]; statuses: CalStatus[] };
}

/**
 * Repli identique aux valeurs par défaut du réglage « calendarKinds » : l'interface reste
 * utilisable (et cohérente) avant la résolution de la requête ou si la section est absente.
 */
const DEFAULT_KINDS: CalKind[] = [
  { key: 'consultation', label: 'Consultation', color: '#3b82f6', durationMin: 30 },
  { key: 'control', label: 'Visite de contrôle', color: '#14b8a6', durationMin: 20 },
  { key: 'procedure', label: 'Procédure', color: '#8b5cf6', durationMin: 45 },
  { key: 'lab', label: 'Analyse', color: '#f59e0b', durationMin: 15 },
  { key: 'radio', label: 'Radiologie', color: '#0ea5b7', durationMin: 30 },
];
const DEFAULT_STATUSES: CalStatus[] = [
  { key: 'pending', label: 'En attente', color: '#f59e0b' },
  { key: 'confirmed', label: 'Confirmé', color: '#3b82f6' },
  { key: 'done', label: 'Terminé', color: '#10b981' },
  { key: 'cancelled', label: 'Annulé', color: '#ef4444' },
  { key: 'no_show', label: 'Non présenté', color: '#64748b' },
];

const FALLBACK: DisplayCfg = {
  dateDisplay: 'DD/MM/YYYY',
  timeDisplay: true,
  steps: [],
  calendarKinds: { kinds: DEFAULT_KINDS, statuses: DEFAULT_STATUSES },
};

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

/* ------------------------------------------------------------------ étiquettes calendrier */

/** Types de RDV effectifs (réglage « calendarKinds », repli sur les valeurs par défaut). */
export function calKinds(cfg: DisplayCfg): CalKind[] {
  const k = cfg.calendarKinds?.kinds;
  return k && k.length > 0 ? k : DEFAULT_KINDS;
}
/** Statuts de RDV effectifs. */
export function calStatuses(cfg: DisplayCfg): CalStatus[] {
  const s = cfg.calendarKinds?.statuses;
  return s && s.length > 0 ? s : DEFAULT_STATUSES;
}

/**
 * Accroche unique pour tout ce qui touche aux étiquettes du calendrier : listes de choix
 * (Select), libellés et couleurs. Les valeurs viennent de la base — ajouter un type de RDV
 * ne demande plus aucune modification de code.
 */
export function useCalendarKinds(): {
  kinds: CalKind[];
  statuses: CalStatus[];
  kindOptions: { value: string; label: string }[];
  statusOptions: { value: string; label: string }[];
  kindLabel: (key: unknown) => string;
  kindColor: (key: unknown) => string;
  statusLabel: (key: unknown) => string;
  statusColor: (key: unknown) => string;
  kindDuration: (key: unknown) => number;
} {
  const cfg = useDisplayCfg();
  const kinds = calKinds(cfg);
  const statuses = calStatuses(cfg);
  return {
    kinds,
    statuses,
    kindOptions: kinds.map((k) => ({ value: k.key, label: k.label })),
    statusOptions: statuses.map((s) => ({ value: s.key, label: s.label })),
    // Une clé inconnue (ancien RDV, type supprimé) reste lisible : on affiche la clé brute.
    kindLabel: (key: unknown) => kinds.find((k) => k.key === String(key ?? ''))?.label ?? (key ? String(key) : '—'),
    kindColor: (key: unknown) => kinds.find((k) => k.key === String(key ?? ''))?.color ?? '#64748b',
    statusLabel: (key: unknown) => statuses.find((s) => s.key === String(key ?? ''))?.label ?? (key ? String(key) : '—'),
    statusColor: (key: unknown) => statuses.find((s) => s.key === String(key ?? ''))?.color ?? '#64748b',
    kindDuration: (key: unknown) => kinds.find((k) => k.key === String(key ?? ''))?.durationMin ?? 30,
  };
}
