/**
 * TEST DE NON-RÉGRESSION — statuts de rendez-vous (422 « Unprocessable Entity »).
 * ------------------------------------------------------------------------------
 * Bug corrigé : le schéma Zod partagé n'acceptait que pending | confirmed | done | cancelled |
 * no_show, alors que la base et le jeu de démonstration contenaient « scheduled » (colonne
 * appointments.status : DEFAULT 'scheduled' à l'origine) et que la liste des statuts est un
 * RÉGLAGE ADMIN (« calendarKinds » → statuses). Conséquence observée dans la console du
 * navigateur : `PUT /api/v1/appointments/5 422` dès qu'on enregistrait un rendez-vous existant
 * (édition depuis le calendrier ou l'onglet « rendez-vous » du dossier patient).
 *
 * Les tests verrouillent : la normalisation des alias historiques, la tolérance aux clés
 * personnalisées du réglage, et le chemin « glisser-déposer » (partial, sans statut).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APPOINTMENT_STATUS_ALIASES, appointmentBaseZ, normalizeAppointmentStatus } from '@sardpi/shared';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sardpi-appt-'));
fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
process.env.SARDPI_ROOT = tmp;

const { appointmentPatch } = await import('../apps/web/src/server/modules/appointments');
const { TABLE_BY_NAME } = await import('../apps/web/src/server/data/schema');

const base = { patientId: 5, startAt: '2026-10-06T09:00:00.000Z', endAt: '2026-10-06T09:30:00.000Z' };

describe('statuts de rendez-vous', () => {
  it('statut absent → « pending » (défaut du schéma)', () => {
    expect(appointmentBaseZ.parse(base).status).toBe('pending');
  });

  it('les alias historiques sont normalisés à l’écriture', () => {
    expect(appointmentBaseZ.parse({ ...base, status: 'scheduled' }).status).toBe('pending');
    expect(appointmentBaseZ.parse({ ...base, status: 'waiting' }).status).toBe('confirmed');
    expect(appointmentBaseZ.parse({ ...base, status: 'noshow' }).status).toBe('no_show');
    expect(APPOINTMENT_STATUS_ALIASES.waiting).toBe('confirmed');
    expect(normalizeAppointmentStatus('done')).toBe('done'); // valeur canonique inchangée
  });

  it('une clé personnalisée du réglage calendarKinds est acceptée telle quelle', () => {
    expect(appointmentBaseZ.parse({ ...base, status: 'visio' }).status).toBe('visio');
  });

  it('statut vide refusé (jamais d’écriture d’un statut vide)', () => {
    expect(() => appointmentBaseZ.parse({ ...base, status: '' })).toThrow();
  });

  it('mise à jour partielle (glisser-déposer : startAt/endAt seuls) toujours valide', () => {
    const patch = appointmentBaseZ.partial().parse({ startAt: base.startAt, endAt: base.endAt });
    expect(patch.startAt).toBe(base.startAt);
    expect(patch.status).toBeUndefined(); // non fourni → non modifié par mapInput
  });

  it('colonne status : indexée, NOT NULL, défaut « pending » (la spec « ~scheduled+i » avalait le i dans le défaut)', () => {
    const col = TABLE_BY_NAME.get('appointments')!.cols.find((c) => c.name === 'status')!;
    expect({ notNull: col.notNull, indexed: col.indexed, def: col.def }).toEqual({ notNull: true, indexed: true, def: 'pending' });
  });

  it('une mise à jour partielle ne réécrit QUE les colonnes transmises (pas de praticien/lieu/type/notes perdus)', () => {
    const parsed = appointmentBaseZ.partial().parse({ startAt: base.startAt, endAt: base.endAt }) as Record<string, unknown>;
    const patch = appointmentPatch(parsed, 'update');
    expect(Object.keys(patch).sort()).toEqual(['end_at', 'start_at']);
    expect(patch).not.toHaveProperty('practitioner_id');
    expect(patch).not.toHaveProperty('status');
    expect(patch).not.toHaveProperty('notes');
  });

  it('création : tous les défauts sont matérialisés (kind/status/all_day)', () => {
    const parsed = appointmentBaseZ.parse(base) as Record<string, unknown>;
    const patch = appointmentPatch(parsed, 'create');
    expect(patch.kind).toBe('consultation');
    expect(patch.status).toBe('pending');
    expect(patch.all_day).toBe(0);
    expect(patch.patient_id).toBe(5);
  });
});
