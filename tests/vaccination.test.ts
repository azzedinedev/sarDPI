/**
 * CARNET VACCINAL — calendrier administrable + doses rattachées au dossier patient.
 * --------------------------------------------------------------------------------
 * Le module est passé d'une simple section de Paramètres (une liste de vaccins sans aucun suivi) à
 * un module métier : Administration » Vaccination gère le calendrier, le dossier patient affiche la
 * couverture, et chaque dose est stockée dans `patient_vaccinations` avec `patient_id` obligatoire.
 *
 * Ces tests verrouillent ce qui ne se voit pas à l'œil :
 *   1. les CALCULS d'échéance et de couverture (fonctions pures partagées front/back) — une échéance
 *      fausse passe inaperçue en démonstration et devient un rendez-vous manqué en production ;
 *   2. le schéma Zod des doses (patient obligatoire, bornes, statuts) ;
 *   3. le calendrier national par défaut (clés conformes, libellés 4 langues) ;
 *   4. le RBAC du nouveau module `vaccination` (qui saisit, qui consulte, qui supprime) ;
 *   5. la table et son rattachement au patient (soft delete, recherche, index) ;
 *   6. LA SUITE d'une dose : la dose suivante planifiée après une injection, et les lignes
 *      « à traiter » (retards, refus, rendez-vous manqués) qui portent un geste à l'écran.
 */
import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  ageMonthsOf,
  ageWeeksOf,
  coverageSummary,
  DEFAULT_VACCINATION_SCHEDULE,
  dosesOf,
  nextDoseInSeries,
  MODULES,
  SEED_ROLES,
  vaccineDueDate,
  vaccinationCoverage,
  vaccinationDoseUpdateZ,
  vaccinationDoseZ,
  vaccinationEntryZ,
  vaccinationDoseStatusZ,
  vaccinationFollowUps,
  vaccinationPlan,
  vaccinationSectionZ,
  VACCINATION_STATUSES,
  can,
  type VaccineScheduleEntry,
} from '@sardpi/shared';
import { TABLES } from '../apps/web/src/server/data/schema';

/** Entrée de calendrier compacte (les helpers tolèrent des entrées partielles). */
const entry = (over: Partial<VaccineScheduleEntry> = {}): VaccineScheduleEntry => ({ key: 'bcg', label: { fr: 'BCG' }, ...over });

const dose = (vaccine_key: string, dose_no: number, status: string, at: string | null = null) => ({ vaccine_key, dose_no, status, administered_at: at, due_at: null });

describe('calcul des échéances (naissance + âge recommandé + intervalle)', () => {
  it('ajoute des mois en bornant le jour (jamais de mois sauté, jamais de dérive)', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28'); // février : jour borné
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29'); // année bissextile
    expect(addMonths('2026-01-15', 12)).toBe('2027-01-15');
    expect(addMonths('2026-01-15', 0)).toBe('2026-01-15');
    expect(addMonths('2026-03-15', -1)).toBe('2026-02-15');
    expect(addMonths('date-invalide', 3)).toBeNull();
  });

  it('ajoute des jours (intervalle entre doses)', () => {
    expect(addDays('2026-02-27', 3)).toBe('2026-03-02');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('échéance = naissance + mois + semaines, puis + intervalle par dose suivante', () => {
    const birth = '2026-01-05';
    expect(vaccineDueDate(birth, entry({ ageMonths: 0, ageWeeks: 6 }), 1)).toBe('2026-02-16'); // 6 semaines
    expect(vaccineDueDate(birth, entry({ ageMonths: 9 }), 1)).toBe('2026-10-05');
    expect(vaccineDueDate(birth, entry({ ageMonths: 0, ageWeeks: 6, intervalDays: 28 }), 2)).toBe('2026-03-16');
    expect(vaccineDueDate(birth, entry({ ageMonths: 6, ageWeeks: 2 }), 1)).toBe('2026-07-19'); // mois PUIS semaines
  });

  it('sans date de naissance : aucune échéance inventée (null, pas « aujourd’hui »)', () => {
    expect(vaccineDueDate(null, entry({ ageMonths: 2 }), 1)).toBeNull();
    expect(vaccineDueDate('', entry({ ageMonths: 2 }), 1)).toBeNull();
  });

  it('lectures tolérantes : bornes appliquées, valeurs absentes = défauts sûrs', () => {
    expect(dosesOf(entry({ doses: 99 }))).toBe(10);
    expect(dosesOf(entry({ doses: 0 }))).toBe(1);
    expect(dosesOf(entry())).toBe(1);
    expect(ageMonthsOf(entry({ ageMonths: -5 }))).toBe(0);
    expect(ageMonthsOf(entry({ ageMonths: 10_000 }))).toBe(300);
    expect(ageWeeksOf(entry({ ageWeeks: 6 }))).toBe(6);
    expect(ageWeeksOf({})).toBe(0);
  });
});

describe('couverture du carnet (état par vaccin)', () => {
  const schedule: VaccineScheduleEntry[] = [
    entry({ key: 'bcg', ageMonths: 0, doses: 1, mandatory: true }),
    entry({ key: 'penta', ageMonths: 0, ageWeeks: 6, doses: 3, intervalDays: 28, mandatory: true }),
    entry({ key: 'mmr', ageMonths: 18, doses: 1 }),
  ];
  const birth = '2026-01-05';

  it('vaccin complet, en cours, à venir et non commencé — états distincts', () => {
    const cov = vaccinationCoverage(schedule, [dose('bcg', 1, 'done', '2026-01-06'), dose('penta', 1, 'done', '2026-02-16')], { birthISO: birth, now: '2026-02-20' });
    const by = Object.fromEntries(cov.map((c) => [c.key, c]));
    expect(by['bcg']!.state).toBe('complete');
    expect(by['bcg']!.nextDoseNo).toBeNull();
    expect(by['penta']!.state).toBe('in_progress'); // dose 2 due le 16/03, nous sommes le 20/02
    expect(by['penta']!.done).toBe(1);
    expect(by['penta']!.nextDoseNo).toBe(2);
    expect(by['penta']!.nextDueAt).toBe('2026-03-16');
    expect(by['mmr']!.state).toBe('upcoming'); // 18 mois : largement à venir
    expect(by['mmr']!.overdue).toBe(false);
  });

  it('retard : échéance dépassée → état « due » + drapeau overdue', () => {
    const cov = vaccinationCoverage(schedule, [dose('bcg', 1, 'done', '2026-01-06')], { birthISO: birth, now: '2026-06-01' });
    const penta = cov.find((c) => c.key === 'penta')!;
    expect(penta.state).toBe('due');
    expect(penta.overdue).toBe(true);
    expect(penta.nextDoseNo).toBe(1);
  });

  it('refus tracé : la dernière saisie « refused » l’emporte sur « à venir »', () => {
    const cov = vaccinationCoverage(schedule, [dose('mmr', 1, 'refused')], { birthISO: birth, now: '2026-02-01' });
    expect(cov.find((c) => c.key === 'mmr')!.state).toBe('refused');
  });

  it('une dose dont le vaccin a été retiré du calendrier n’est JAMAIS perdue', () => {
    const cov = vaccinationCoverage(schedule, [dose('oldvax', 1, 'done', '2025-01-01'), dose('bcg', 1, 'done')], { birthISO: birth });
    const orphan = cov.find((c) => c.key === 'oldvax');
    expect(orphan, 'dose orpheline absente du carnet').toBeTruthy();
    expect(orphan!.done).toBe(1);
    expect(cov).toHaveLength(schedule.length + 1);
  });

  it('vaccin désactivé (active=false) : absent de la couverture, mais ses doses restent visibles', () => {
    const withInactive = [...schedule, entry({ key: 'rota', active: false })];
    const cov = vaccinationCoverage(withInactive, [dose('rota', 1, 'done')], { birthISO: birth });
    expect(cov.map((c) => c.key)).toContain('rota'); // la dose existe → la ligne est conservée
    const covNoDose = vaccinationCoverage(withInactive, [], { birthISO: birth });
    expect(covNoDose.map((c) => c.key)).not.toContain('rota');
  });

  it('synthèse : pourcentage de doses faites, vaccins complets, retards', () => {
    const cov = vaccinationCoverage(schedule, [dose('bcg', 1, 'done'), dose('penta', 1, 'done'), dose('penta', 2, 'done')], { birthISO: birth, now: '2026-02-01' });
    const s = coverageSummary(cov);
    expect(s).toMatchObject({ vaccines: 3, mandatory: 2, complete: 1, dosesDone: 3, dosesExpected: 5, percent: 60 });
    expect(coverageSummary([])).toMatchObject({ vaccines: 0, dosesExpected: 0, percent: 0 });
  });
});

describe('plan de vaccination (génération des doses manquantes)', () => {
  it('une ligne par dose prévue, avec échéance calculée', () => {
    const plan = vaccinationPlan([entry({ key: 'penta', ageWeeks: 6, doses: 3, intervalDays: 28 })], '2026-01-05');
    expect(plan).toEqual([
      { vaccineKey: 'penta', doseNo: 1, dueAt: '2026-02-16' },
      { vaccineKey: 'penta', doseNo: 2, dueAt: '2026-03-16' },
      { vaccineKey: 'penta', doseNo: 3, dueAt: '2026-04-13' },
    ]);
  });

  it('sans date de naissance : les doses sont planifiées, échéances nulles', () => {
    const plan = vaccinationPlan([entry({ doses: 2 })], null);
    expect(plan).toHaveLength(2);
    expect(plan.every((p) => p.dueAt === null)).toBe(true);
  });

  it('vaccins désactivés ignorés', () => {
    expect(vaccinationPlan([entry({ key: 'rota', active: false })], '2026-01-05')).toEqual([]);
  });
});

describe('la suite d\'une dose (dose suivante + lignes à traiter)', () => {
  it('dose administrée → la suivante est planifiée à date d\'administration + intervalle', () => {
    const e = entry({ key: 'penta', doses: 3, intervalDays: 60 });
    const next = nextDoseInSeries(e, [{ vaccine_key: 'penta', dose_no: 1, status: 'done' }], 1, {
      birthISO: '2026-01-01',
      administeredAt: '2026-03-01',
    });
    expect(next).toEqual({ doseNo: 2, dueAt: '2026-04-30' }); // 01/03 + 60 jours
  });

  it('rattrapage en désordre : la première dose MANQUANTE est proposée (pas simplement la suivante)', () => {
    const e = entry({ key: 'penta', doses: 3, intervalDays: 30 });
    const next = nextDoseInSeries(e, [{ vaccine_key: 'penta', dose_no: 2, status: 'done' }], 2, { administeredAt: '2026-05-01' });
    expect(next?.doseNo).toBe(1); // la dose 1 n'a jamais été faite
  });

  it('série terminée, vaccin inconnu du calendrier, ou dose hors série → rien à planifier', () => {
    const e = entry({ key: 'bcg', doses: 1 });
    expect(nextDoseInSeries(e, [], 1, { administeredAt: '2026-01-01' })).toBeNull();
    expect(nextDoseInSeries(null, [], 1, { administeredAt: '2026-01-01' })).toBeNull();
    expect(nextDoseInSeries(e, [], 4, { administeredAt: '2026-01-01' })).toBeNull();
  });

  it('jamais de date inventée : sans intervalle ni date de naissance, aucune échéance n\'est proposée', () => {
    const e = entry({ key: 'ror', doses: 2, intervalDays: 0 });
    expect(nextDoseInSeries(e, [], 1, { administeredAt: '2026-01-01' })).toBeNull();
    // avec la date de naissance et un âge recommandé, l'échéance théorique du calendrier prend le relais
    const withAge = entry({ key: 'ror', doses: 2, intervalDays: 0, ageMonths: 6 });
    const byCalendar = nextDoseInSeries(withAge, [], 1, { birthISO: '2025-01-01', administeredAt: '2026-01-01' });
    expect(byCalendar).toEqual({ doseNo: 2, dueAt: '2025-07-01' }); // naissance + 6 mois
  });

  it('lignes « à traiter » : retards triés du plus ancien, refus et rendez-vous manqués inclus, doses faites exclues', () => {
    const cov = vaccinationCoverage(
      [
        { key: 'bcg', label: { fr: 'BCG' }, doses: 1 },
        { key: 'penta', label: { fr: 'Penta' }, doses: 1 },
        { key: 'ror', label: { fr: 'ROR' }, doses: 1 },
      ],
      [
        { id: 1, vaccine_key: 'bcg', dose_no: 1, status: 'done', administered_at: '2026-01-01', due_at: '2026-01-01' },
        { id: 2, vaccine_key: 'penta', dose_no: 1, status: 'planned', due_at: '2026-02-01' },
        { id: 3, vaccine_key: 'ror', dose_no: 1, status: 'refused', due_at: '2026-03-01' },
      ],
      { now: '2026-06-01' },
    );
    const ups = vaccinationFollowUps(cov, { now: '2026-06-01' });
    expect(ups.map((u) => u.vaccineKey)).toEqual(['penta', 'ror']); // le plus ancien retard d'abord
    expect(ups[0]).toMatchObject({ overdue: true, doseId: 2, doseCode: null, daysLate: 120 });
    expect(ups[1]).toMatchObject({ refused: true, overdue: true, doseId: 3 });
  });

  it('vaccin sans aucune dose saisie : la ligne à traiter propose une CRÉATION (doseId nul)', () => {
    const cov = vaccinationCoverage([{ key: 'mmr', label: { fr: 'ROR' }, doses: 1 }], [], { birthISO: '2020-01-01', now: '2026-06-01' });
    const ups = vaccinationFollowUps(cov, { now: '2026-06-01' });
    expect(ups).toHaveLength(1);
    expect(ups[0]).toMatchObject({ vaccineKey: 'mmr', doseId: null, doseNo: 1, overdue: true });
  });

  it('carnet à jour : aucune ligne à traiter (le panneau ne s\'affiche pas)', () => {
    const cov = vaccinationCoverage([{ key: 'bcg', label: { fr: 'BCG' }, doses: 1 }], [{ vaccine_key: 'bcg', dose_no: 1, status: 'done' }], { now: '2026-06-01' });
    expect(vaccinationFollowUps(cov, { now: '2026-06-01' })).toEqual([]);
  });
});

describe('schémas partagés (mêmes règles côté écran et côté API)', () => {
  it('une dose exige un patient — le rattachement au dossier n’est pas optionnel', () => {
    expect(vaccinationDoseZ.safeParse({ vaccineKey: 'bcg', doseNo: 1 }).success).toBe(false);
    const ok = vaccinationDoseZ.safeParse({ patientId: 7, vaccineKey: 'bcg', doseNo: 1 });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.status).toBe('done'); // statut par défaut = administrée
  });

  it('bornes et motifs : clé de vaccin, n° de dose, statut', () => {
    expect(vaccinationDoseZ.safeParse({ patientId: 1, vaccineKey: 'BCG', doseNo: 1 }).success).toBe(false); // majuscules refusées
    expect(vaccinationDoseZ.safeParse({ patientId: 1, vaccineKey: 'bcg', doseNo: 0 }).success).toBe(false);
    expect(vaccinationDoseZ.safeParse({ patientId: 1, vaccineKey: 'bcg', doseNo: 11 }).success).toBe(false);
    expect(vaccinationDoseZ.safeParse({ patientId: 1, vaccineKey: 'bcg', doseNo: 1, status: 'invented' }).success).toBe(false);
    for (const status of VACCINATION_STATUSES) {
      expect(vaccinationDoseZ.safeParse({ patientId: 1, vaccineKey: 'bcg', doseNo: 1, status }).success, status).toBe(true);
    }
  });

  it('transition rapide : un report exige une échéance, une injection accepte la date du jour', () => {
    // « done » sans date → autorisé (le serveur date du jour)
    expect(vaccinationDoseStatusZ.safeParse({ action: 'done' }).success).toBe(true);
    expect(vaccinationDoseStatusZ.safeParse({ action: 'done', administeredAt: '2026-01-10', batch: 'LOT-1', planNext: false }).success).toBe(true);
    // « planned » (report) sans nouvelle échéance → refusé, avec le champ fautif nommé
    const report = vaccinationDoseStatusZ.safeParse({ action: 'planned' });
    expect(report.success).toBe(false);
    if (!report.success) expect(report.error.issues[0]?.path).toContain('dueAt');
    expect(vaccinationDoseStatusZ.safeParse({ action: 'planned', dueAt: '2026-09-01', reason: 'report famille' }).success).toBe(true);
    // refus / rendez-vous manqué : motif libre borné
    expect(vaccinationDoseStatusZ.safeParse({ action: 'refused', reason: 'x'.repeat(501) }).success).toBe(false);
    expect(vaccinationDoseStatusZ.safeParse({ action: 'missed', reason: 'absent' }).success).toBe(true);
    // aucun statut inventé
    expect(vaccinationDoseStatusZ.safeParse({ action: 'annulee' }).success).toBe(false);
  });

  it('mise à jour partielle : le patient ne peut pas être déplacé vers un autre dossier', () => {
    expect('patientId' in vaccinationDoseUpdateZ.shape).toBe(false);
    expect(vaccinationDoseUpdateZ.safeParse({ status: 'planned' }).success).toBe(true);
    expect(vaccinationDoseUpdateZ.safeParse({}).success).toBe(true);
  });

  it('entrée de calendrier : âges structurés (mois + semaines) avec défauts à 0', () => {
    const parsed = vaccinationEntryZ.parse({ key: 'penta1' });
    expect(parsed).toMatchObject({ ageMonths: 0, ageWeeks: 0, doses: 1, intervalDays: 0, mandatory: false, active: true });
    expect(vaccinationEntryZ.safeParse({ key: 'PENTA-1' }).success).toBe(false);
    expect(vaccinationEntryZ.safeParse({ key: 'penta1', ageWeeks: 9999 }).success).toBe(false);
    // clés inconnues d'une entrée historique : préservées (passthrough)
    expect(vaccinationEntryZ.parse({ key: 'bcg', legacy: 'x' })).toMatchObject({ legacy: 'x' });
    expect(vaccinationSectionZ.parse({}).schedule).toEqual([]);
  });

  it('calendrier national par défaut : clés conformes, libellés 4 langues, âges cohérents', () => {
    expect(DEFAULT_VACCINATION_SCHEDULE.length).toBeGreaterThanOrEqual(10);
    const keys = DEFAULT_VACCINATION_SCHEDULE.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const e of DEFAULT_VACCINATION_SCHEDULE) {
      expect(vaccinationEntryZ.safeParse(e).success, `entrée ${e.key} invalide`).toBe(true);
      for (const lang of ['fr', 'ar', 'es', 'en']) expect(e.label?.[lang], `${e.key}.${lang}`).toBeTruthy();
      expect(ageMonthsOf(e) * 30 + ageWeeksOf(e) * 7).toBeLessThanOrEqual(73 * 30); // au plus ~6 ans
    }
    // repères du calendrier algérien : naissance, 6/10/14 semaines, 9 mois, 18 mois, 6 ans
    expect(keys).toContain('bcg');
    expect(DEFAULT_VACCINATION_SCHEDULE.find((e) => e.key === 'penta1')!.ageWeeks).toBe(6);
    expect(DEFAULT_VACCINATION_SCHEDULE.find((e) => e.key === 'measles1')!.ageMonths).toBe(9);
    expect(DEFAULT_VACCINATION_SCHEDULE.find((e) => e.key === 'mmr2')!.ageMonths).toBe(72);
  });
});

describe('RBAC du module vaccination', () => {
  const perms = (role: string): string[] => SEED_ROLES.find((r) => r.key === role)!.perms;

  it('le module est déclaré (matrice de permissions côté API et UI)', () => {
    expect(MODULES).toContain('vaccination');
  });

  it('médecin : droits complets ; infirmier : saisie et suivi, pas de suppression', () => {
    expect(can(perms('physician'), 'vaccination', 'view')).toBe(true);
    expect(can(perms('physician'), 'vaccination', 'delete')).toBe(true);
    expect(can(perms('nurse'), 'vaccination', 'create')).toBe(true);
    expect(can(perms('nurse'), 'vaccination', 'update')).toBe(true);
    expect(can(perms('nurse'), 'vaccination', 'delete')).toBe(false);
  });

  it('accueil : consultation et planification, sans modification ni export', () => {
    expect(can(perms('secretary'), 'vaccination', 'view')).toBe(true);
    expect(can(perms('secretary'), 'vaccination', 'create')).toBe(true);
    expect(can(perms('secretary'), 'vaccination', 'update')).toBe(false);
    expect(can(perms('secretary'), 'vaccination', 'export')).toBe(false);
  });

  it('rôles sans lien clinique : aucun accès (technicien de laboratoire, radiologue)', () => {
    expect(can(perms('labtech'), 'vaccination', 'view')).toBe(false);
    expect(can(perms('radiologist'), 'vaccination', 'view')).toBe(false);
    expect(can(perms('admin'), 'vaccination', 'delete')).toBe(true); // joker administrateur
  });
});

describe('persistance — table patient_vaccinations', () => {
  const table = TABLES.find((t) => t.name === 'patient_vaccinations');

  it('la table existe, en suppression logique, avec recherche et index patient', () => {
    expect(table, 'table absente du schéma').toBeTruthy();
    expect(table!.softDelete).toBe(true);
    expect(table!.search).toEqual(expect.arrayContaining(['code', 'vaccine_key', 'batch']));
    expect(table!.indexes?.some((i) => i.cols[0] === 'patient_id')).toBe(true);
  });

  it('rattachement au dossier patient : patient_id obligatoire et indexé, dose et statut bornés', () => {
    const col = (name: string) => table!.cols.find((c) => c.name === name);
    expect(col('patient_id')).toMatchObject({ notNull: true, indexed: true });
    expect(col('vaccine_key')).toMatchObject({ notNull: true, indexed: true });
    expect(col('dose_no')).toMatchObject({ notNull: true });
    expect(col('status')).toMatchObject({ notNull: true });
    expect(col('code')).toMatchObject({ unique: true }); // code métier VAX-000001 immuable
    expect(col('administered_at')?.kind).toBe('date');
    expect(col('due_at')?.kind).toBe('date');
    expect(col('record_id'), 'traçabilité vers la fiche médicale').toBeTruthy();
  });
});
