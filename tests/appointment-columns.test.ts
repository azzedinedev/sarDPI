/**
 * TEST DE NON-RÉGRESSION — colonnes appointments.kind / appointments.all_day.
 * -------------------------------------------------------------------------------------------
 * Défaut corrigé : le module rendez-vous écrivait `kind` (type de RDV, clé de `calendarKinds.kinds`)
 * et `all_day` dès la création/édition, mais la table ne possédait PAS ces colonnes. L'adaptateur
 * ne sérialisant que les colonnes déclarées, les deux valeurs étaient silencieusement perdues :
 * au rechargement, le calendrier retombait systématiquement sur « consultation ».
 *
 * Ce que verrouillent ces tests :
 *   1. les colonnes existent dans le schéma (elles conditionnent la sérialisation SQL/JSON) ;
 *   2. la sérialisation les conserve réellement (valeur par défaut comprise) ;
 *   3. l'API normalise les lignes historiques (NULL) au lieu de renvoyer `undefined` ;
 *   4. la migration 0002 existe en variantes mysql/postgres et le planificateur ne croise jamais
 *      les dialectes (sinon `ADD COLUMN IF NOT EXISTS` casserait une base MySQL 8).
 */
import { describe, expect, it } from 'vitest';
import { TABLES } from '../apps/web/src/server/data/schema';
import { serializeRow } from '../apps/web/src/server/data/cast';
import { dialectOf, isAlreadyAppliedError, migrationFiles } from '../apps/web/src/server/data/migrations';
import { appointmentPatch, normalizeAppointment } from '../apps/web/src/server/modules/appointments';

const appointments = TABLES.find((t) => t.name === 'appointments')!;
const colNames = appointments.cols.map((c) => c.name);

describe('schéma appointments', () => {
  it('déclare kind et all_day (sinon toute écriture est perdue à la sérialisation)', () => {
    expect(colNames).toContain('kind');
    expect(colNames).toContain('all_day');
    const kind = appointments.cols.find((c) => c.name === 'kind')!;
    const allDay = appointments.cols.find((c) => c.name === 'all_day')!;
    expect(kind.kind).toBe('str');
    expect(kind.notNull).toBe(true);
    expect(kind.def).toBe('consultation'); // installation existante : jamais de ligne sans type
    expect(allDay.kind).toBe('bool');
    expect(allDay.def).toBe('0');
  });

  it('la sérialisation conserve kind/all_day et ramène all_day à 0/1', () => {
    const row = serializeRow('appointments', { kind: 'radio', all_day: true, start_at: '2026-01-01T09:00:00.000Z' }, false);
    expect(row.kind).toBe('radio');
    expect(row.all_day).toBe(1);
    expect(serializeRow('appointments', { all_day: false }, false).all_day).toBe(0);
  });
});

describe('normalisation des lignes d’agenda', () => {
  it('une ligne historique sans colonnes reçoit des valeurs par défaut exploitables', () => {
    const out = normalizeAppointment({ id: 5, code: 'RDV-000005' });
    expect(out.kind).toBe('consultation');
    expect(out.all_day).toBe(0);
  });

  it('respecte les valeurs stockées et ne crée pas de doublons de type', () => {
    const out = normalizeAppointment({ kind: 'lab', all_day: 1 });
    expect(out.kind).toBe('lab');
    expect(out.all_day).toBe(1);
    // la ligne d'origine n'est pas modifiée (fonction pure, utilisable dans un map)
    const src: Record<string, unknown> = { kind: 'lab' };
    normalizeAppointment(src);
    expect(src.all_day).toBeUndefined();
  });

  it('la création pose bien les deux colonnes, la modification partielle les préserve', () => {
    const created = appointmentPatch({ startAt: '2026-01-01T09:00:00Z', endAt: '2026-01-01T09:30:00Z' }, 'create');
    expect(created.kind).toBe('consultation');
    expect(created.all_day).toBe(0);
    // glisser-déposer : le patch ne réécrit ni le type ni la journée entière
    const moved = appointmentPatch({ startAt: '2026-01-02T10:00:00Z', endAt: '2026-01-02T10:30:00Z' }, 'update');
    expect(moved).not.toHaveProperty('kind');
    expect(moved).not.toHaveProperty('all_day');
    expect(appointmentPatch({ kind: 'radio', allDay: true }, 'update')).toMatchObject({ kind: 'radio', all_day: 1 });
  });
});

describe('migrations SQL — sélection par dialecte', () => {
  const files = ['0001-normalize-appointment-status.sql', '0002-appointments-kind-all-day.mysql.sql', '0002-appointments-kind-all-day.postgres.sql', 'notes.txt'];

  it('chaque dialecte ne reçoit que ses fichiers + les portables, dans l’ordre', () => {
    expect(migrationFiles(files, 'mysql')).toEqual(['0001-normalize-appointment-status.sql', '0002-appointments-kind-all-day.mysql.sql']);
    expect(migrationFiles(files, 'postgres')).toEqual(['0001-normalize-appointment-status.sql', '0002-appointments-kind-all-day.postgres.sql']);
    expect(dialectOf('0002-x.mysql.sql')).toBe('mysql');
    expect(dialectOf('0001-x.sql')).toBeNull();
  });

  it('le rejeu est toléré (base déjà migrée) mais pas une vraie panne', () => {
    expect(isAlreadyAppliedError('ER_DUP_FIELDNAME: Duplicate column name \'kind\'')).toBe(true);
    expect(isAlreadyAppliedError('relation "appointments" already exists')).toBe(true);
    expect(isAlreadyAppliedError('Syntax error near "ADD"')).toBe(false);
  });
});
