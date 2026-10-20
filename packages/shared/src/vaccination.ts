/**
 * CARNET VACCINAL — logique PURE partagée front/back (aucun accès base ni horizon).
 * --------------------------------------------------------------------------------
 * Le calendrier vaccinal est administrable (Administration » Vaccination, section de réglages
 * `vaccination`) ; les doses administrées/planifiées vivent en base (`patient_vaccinations`) et
 * sont rattachées au dossier patient. Trois calculs reviennent partout — échéance d'une dose,
 * état de couverture d'un vaccin, synthèse du carnet — d'où ce module unique, testable sans
 * rendre ni interroger quoi que ce soit :
 *
 *   - `vaccineDueDate()`      naissance + âge recommandé + (n° de dose − 1) × intervalle ;
 *   - `vaccinationCoverage()` une ligne par vaccin du calendrier, avec son état (complet, en cours,
 *                             dû/en retard, à venir, refusé) et la prochaine échéance ;
 *   - `coverageSummary()`     totals affichés dans l'en-tête du carnet (pourcentage, retards).
 *
 * Les entrées du calendrier conservent leurs clés inconnues (schéma `passthrough`) : ces fonctions
 * n'exigent que `key`, et lisent le reste avec des valeurs par défaut sûres.
 */
import { z } from 'zod';
import { idZ } from './entities';
import type { MultiLabel } from './labels';

/** Statuts d'une dose : administrée, planifiée (à faire), refusée, manquée (rendez-vous non honoré). */
export const VACCINATION_STATUSES = ['done', 'planned', 'refused', 'missed'] as const;
export type VaccinationStatus = (typeof VACCINATION_STATUSES)[number];

/** Statuts considérés comme « la dose a eu lieu » dans le calcul de couverture. */
export const VACCINATION_DONE_STATUSES: readonly VaccinationStatus[] = ['done'];

/**
 * Une dose du carnet (création). Le patient est obligatoire : une vaccination sans dossier patient
 * n'a pas de sens clinique — c'est l'association demandée (carnet ↔ dossier).
 * `administeredAt` reste facultatif : une dose PLANIFIÉE n'a pas encore de date d'administration.
 */
export const vaccinationDoseZ = z.object({
  patientId: idZ,
  vaccineKey: z.string().regex(/^[a-z0-9_]{2,30}$/, 'vaccineKey'),
  doseNo: z.number().int().min(1).max(10).default(1),
  status: z.enum(VACCINATION_STATUSES).default('done'),
  administeredAt: z.string().min(8).max(32).optional().nullable(),
  dueAt: z.string().min(8).max(32).optional().nullable(),
  site: z.string().max(40).optional().nullable(),
  batch: z.string().max(60).optional().nullable(),
  practitionerId: idZ.optional().nullable(),
  locationId: idZ.optional().nullable(),
  recordId: idZ.optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});
export const vaccinationDoseUpdateZ = vaccinationDoseZ.omit({ patientId: true }).partial();
export type VaccinationDoseInput = z.infer<typeof vaccinationDoseZ>;

/** Une entrée du calendrier vaccinal (settings.vaccination.schedule[]) — lecture tolérante. */
export interface VaccineScheduleEntry {
  key: string;
  label?: MultiLabel | Record<string, string>;
  /** Âge recommandé : mois entiers (0 = naissance) + semaines (calendrier nourrisson : 6, 10, 14 sem.). */
  ageMonths?: number;
  ageWeeks?: number;
  ageLabel?: string;
  doses?: number;
  intervalDays?: number;
  mandatory?: boolean;
  active?: boolean;
  [extra: string]: unknown;
}

/** Une dose du carnet (ligne `patient_vaccinations`) — lecture tolérante. */
export interface VaccineDose {
  id?: number;
  vaccine_key: string;
  dose_no?: number | string;
  status?: string;
  administered_at?: string | null;
  due_at?: string | null;
  [extra: string]: unknown;
}

/** État synthétique d'un vaccin du calendrier, au regard des doses saisies. */
export type CoverageState = 'complete' | 'in_progress' | 'due' | 'upcoming' | 'not_started' | 'refused';

export interface VaccineCoverage {
  key: string;
  label: MultiLabel | Record<string, string>;
  ageLabel: string;
  ageMonths: number;
  ageWeeks: number;
  mandatory: boolean;
  dosesTotal: number;
  done: number;
  planned: number;
  refused: number;
  missed: number;
  /** prochaine dose à faire (numéro), ou null si le vaccin est complet */
  nextDoseNo: number | null;
  /** échéance calculée de la prochaine dose (ISO date), ou null */
  nextDueAt: string | null;
  state: CoverageState;
  /** true si la prochaine échéance est dépassée (retard de vaccination) */
  overdue: boolean;
  /** doses du carnet (id + statut + dates) — l'UI les affiche sans second appel */
  doses: VaccineDose[];
}

export interface CoverageSummary {
  vaccines: number;
  mandatory: number;
  complete: number;
  overdue: number;
  dosesDone: number;
  dosesExpected: number;
  /** pourcentage de doses faites (0-100, arrondi) — 0 si aucun vaccin au calendrier */
  percent: number;
}

const DAY_MS = 86_400_000;

function toDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(typeof v === 'string' && v.length <= 10 ? `${v}T12:00:00` : String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Ajoute des mois à une date en bornant le jour (31/01 + 1 mois = 28/02) : les échéances vaccinales
 * ne doivent jamais « sauter » un mois ni dériver d'un jour selon la longueur du mois.
 */
export function addMonths(iso: string, months: number): string | null {
  const base = toDate(iso);
  if (!base) return null;
  const m = Number.isFinite(months) ? Math.trunc(months) : 0;
  const day = base.getDate();
  const target = new Date(base.getFullYear(), base.getMonth() + m, 1, 12);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return isoDay(target);
}

export function addDays(iso: string, days: number): string | null {
  const base = toDate(iso);
  if (!base) return null;
  const d = Number.isFinite(days) ? Math.trunc(days) : 0;
  return isoDay(new Date(base.getTime() + d * DAY_MS));
}

/**
 * Entrée « lue avec tolérance » : les helpers d'extraction acceptent une entrée partielle (clé
 * inconnue du calendrier, ligne héritée d'une ancienne version) et retournent toujours une valeur
 * sûre — un carnet ne doit jamais planter sur une entrée exotique.
 */
export type VaccineEntryLike = Partial<VaccineScheduleEntry>;

/** Nombre de doses prévues par le calendrier (borne 1..10, défaut 1). */
export function dosesOf(entry: VaccineEntryLike): number {
  const n = Number(entry.doses ?? 1);
  if (!Number.isFinite(n)) return 1;
  return Math.min(10, Math.max(1, Math.trunc(n)));
}

/** Intervalle en jours entre deux doses (0 = dose unique / intervalle libre). */
export function intervalOf(entry: VaccineEntryLike): number {
  const n = Number(entry.intervalDays ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.min(3650, Math.max(0, Math.trunc(n)));
}

/** Âge recommandé en mois (0 = naissance) — jamais négatif. */
export function ageMonthsOf(entry: VaccineEntryLike): number {
  const n = Number(entry.ageMonths ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.min(300, Math.max(0, Math.trunc(n)));
}

/** Âge recommandé en semaines (calendrier nourrisson : 6, 10, 14 semaines) — jamais négatif. */
export function ageWeeksOf(entry: VaccineEntryLike): number {
  const n = Number(entry.ageWeeks ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1560, Math.max(0, Math.trunc(n)));
}

/**
 * Échéance d'une dose : naissance + âge recommandé (mois PUIS semaines — l'ordre compte pour les
 * fins de mois), puis + intervalle entre doses pour chaque dose suivante. Sans date de naissance
 * (ou sans entrée) → null : l'UI n'affiche alors aucune échéance plutôt qu'une date fausse.
 */
export function vaccineDueDate(birthISO: string | null | undefined, entry: VaccineScheduleEntry, doseNo = 1): string | null {
  if (!birthISO) return null;
  const byMonth = addMonths(birthISO, ageMonthsOf(entry));
  if (!byMonth) return null;
  const weeks = ageWeeksOf(entry) * 7;
  const first = weeks ? addDays(byMonth, weeks) : byMonth;
  if (!first) return null;
  const extra = Math.max(0, Math.trunc(Number(doseNo) || 1) - 1) * intervalOf(entry);
  return extra ? addDays(first, extra) : first;
}

function statusOf(dose: VaccineDose): VaccinationStatus {
  const s = String(dose.status ?? 'planned');
  return (VACCINATION_STATUSES as readonly string[]).includes(s) ? (s as VaccinationStatus) : 'planned';
}

/**
 * Couverture du carnet : une ligne par vaccin ACTIF du calendrier, avec ses doses saisies.
 * Les doses dont la clé n'existe plus au calendrier (vaccin retiré/désactivé) sont regroupées en
 * fin de liste — un carnet ne doit jamais « perdre » une dose administrée.
 */
export function vaccinationCoverage(
  schedule: VaccineScheduleEntry[],
  doses: VaccineDose[],
  opts: { birthISO?: string | null; now?: Date | string } = {},
): VaccineCoverage[] {
  const now = toDate(opts.now) ?? new Date();
  const today = isoDay(now);
  const byKey = new Map<string, VaccineDose[]>();
  for (const d of doses ?? []) {
    const k = String(d.vaccine_key ?? '');
    if (!k) continue;
    const list = byKey.get(k) ?? [];
    list.push(d);
    byKey.set(k, list);
  }

  const build = (key: string, entry: VaccineScheduleEntry | null): VaccineCoverage => {
    const rows = (byKey.get(key) ?? []).slice().sort((a, b) => Number(a.dose_no ?? 1) - Number(b.dose_no ?? 1));
    const done = rows.filter((r) => statusOf(r) === 'done').length;
    const planned = rows.filter((r) => statusOf(r) === 'planned').length;
    const refused = rows.filter((r) => statusOf(r) === 'refused').length;
    const missed = rows.filter((r) => statusOf(r) === 'missed').length;
    const dosesTotal = entry ? dosesOf(entry) : Math.max(rows.length, 1);
    const doneNos = new Set(rows.filter((r) => statusOf(r) === 'done').map((r) => Number(r.dose_no ?? 1)));
    let nextDoseNo: number | null = null;
    for (let i = 1; i <= dosesTotal; i++) {
      if (!doneNos.has(i)) {
        nextDoseNo = i;
        break;
      }
    }
    const nextDueAt = entry && nextDoseNo ? (opts.birthISO ? vaccineDueDate(opts.birthISO, entry, nextDoseNo) : null) ?? null : null;
    const lastRefused = rows.length > 0 && statusOf(rows[rows.length - 1]!) === 'refused';
    let state: CoverageState;
    if (!entry) state = done > 0 ? 'complete' : 'not_started';
    else if (done >= dosesTotal) state = 'complete';
    else if (lastRefused) state = 'refused';
    else if (nextDueAt && nextDueAt <= today) state = 'due';
    else if (done > 0) state = 'in_progress';
    else if (nextDueAt) state = 'upcoming';
    else state = 'not_started';
    return {
      key,
      label: (entry?.label ?? {}) as MultiLabel,
      ageLabel: String(entry?.ageLabel ?? ''),
      ageMonths: ageMonthsOf(entry ?? {}),
      ageWeeks: ageWeeksOf(entry ?? {}),
      mandatory: Boolean(entry?.mandatory),
      dosesTotal,
      done,
      planned,
      refused,
      missed,
      nextDoseNo,
      nextDueAt,
      state,
      overdue: state === 'due' || state === 'refused' ? Boolean(nextDueAt && nextDueAt < today) : false,
      doses: rows,
    };
  };

  const out = (schedule ?? []).filter((e) => e && e.key && e.active !== false).map((e) => build(String(e.key), e));
  const known = new Set(out.map((x) => x.key));
  for (const key of [...byKey.keys()]) if (!known.has(key)) out.push(build(key, null));
  return out;
}

/** Synthèse d'un carnet (en-tête : « 8/12 doses — 2 en retard »). */
export function coverageSummary(coverage: VaccineCoverage[]): CoverageSummary {
  const vaccines = coverage.length;
  const mandatory = coverage.filter((c) => c.mandatory).length;
  const complete = coverage.filter((c) => c.state === 'complete').length;
  const overdue = coverage.filter((c) => c.overdue).length;
  const dosesDone = coverage.reduce((n, c) => n + c.done, 0);
  const dosesExpected = coverage.reduce((n, c) => n + c.dosesTotal, 0);
  return {
    vaccines,
    mandatory,
    complete,
    overdue,
    dosesDone,
    dosesExpected,
    percent: dosesExpected > 0 ? Math.round((dosesDone / dosesExpected) * 100) : 0,
  };
}

/**
 * Plan de vaccination d'un patient : pour chaque vaccin actif du calendrier, la liste des doses à
 * créer avec leur échéance. Sert à « Générer le calendrier » (Administration » Vaccination, onglet
 * du dossier patient) — idempotent côté serveur : les doses déjà présentes sont ignorées.
 */
export interface PlannedDose {
  vaccineKey: string;
  doseNo: number;
  dueAt: string | null;
}

export function vaccinationPlan(schedule: VaccineScheduleEntry[], birthISO: string | null | undefined): PlannedDose[] {
  const out: PlannedDose[] = [];
  for (const entry of schedule ?? []) {
    if (!entry?.key || entry.active === false) continue;
    const total = dosesOf(entry);
    for (let doseNo = 1; doseNo <= total; doseNo++) {
      out.push({ vaccineKey: String(entry.key), doseNo, dueAt: vaccineDueDate(birthISO, entry, doseNo) });
    }
  }
  return out;
}
