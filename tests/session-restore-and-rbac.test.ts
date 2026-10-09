import { describe, it, expect } from 'vitest';
import { can, SEED_ROLES } from '@sardpi/shared';

describe('Restauration serveur, expiration de session et RBAC navigation', () => {
  it('1. can() résout les permissions aussi bien avec les noms canoniques qu’avec les alias de navigation', () => {
    const physician = SEED_ROLES.find((r) => r.key === 'physician')!;
    expect(physician).toBeTruthy();

    // Patients (canonique 'patient' et alias 'patients')
    expect(can(physician.perms, 'patient', 'view')).toBe(true);
    expect(can(physician.perms, 'patients', 'view')).toBe(true);

    // Calendrier / Rendez-vous (canonique 'appointment' et alias 'calendar')
    expect(can(physician.perms, 'appointment', 'view')).toBe(true);
    expect(can(physician.perms, 'calendar', 'view')).toBe(true);

    // Fiches médicales (canonique 'record.consultation' et alias 'records')
    expect(can(physician.perms, 'record.consultation', 'view')).toBe(true);
    expect(can(physician.perms, 'records', 'view')).toBe(true);

    // Laboratoire (canonique 'record.lab' et alias 'lab')
    expect(can(physician.perms, 'record.lab', 'view')).toBe(true);
    expect(can(physician.perms, 'lab', 'view')).toBe(true);

    // Pharmacie (canonique 'record.pharmacy' et alias 'pharmacy')
    expect(can(physician.perms, 'record.pharmacy', 'view')).toBe(true);
    expect(can(physician.perms, 'pharmacy', 'view')).toBe(true);

    // Ordonnances (canonique 'prescription' et alias 'prescriptions')
    expect(can(physician.perms, 'prescription', 'view')).toBe(true);
    expect(can(physician.perms, 'prescriptions', 'view')).toBe(true);

    // GED
    expect(can(physician.perms, 'ged', 'view')).toBe(true);

    // Lieux (canonique 'location' et alias 'locations')
    expect(can(physician.perms, 'location', 'view')).toBe(true);
    expect(can(physician.perms, 'locations', 'view')).toBe(true);

    // Messages / Notifications (canonique 'message' et alias 'notifications')
    expect(can(physician.perms, 'message', 'view')).toBe(true);
    expect(can(physician.perms, 'notifications', 'view')).toBe(true);

    // Médecin ne doit pas avoir accès aux sections d'administration système
    expect(can(physician.perms, 'admin', 'view')).toBe(false);
    expect(can(physician.perms, 'user', 'view')).toBe(false);
  });

  it('2. Les rôles non-admin voient leurs menus métiers et non pas uniquement le tableau de bord', () => {
    const nurse = SEED_ROLES.find((r) => r.key === 'nurse')!;
    expect(can(nurse.perms, 'patient', 'view')).toBe(true);
    expect(can(nurse.perms, 'appointment', 'view')).toBe(true);
    expect(can(nurse.perms, 'location', 'view')).toBe(true);
    expect(can(nurse.perms, 'record.care', 'view')).toBe(true);

    const labtech = SEED_ROLES.find((r) => r.key === 'labtech')!;
    expect(can(labtech.perms, 'patient', 'view')).toBe(true);
    expect(can(labtech.perms, 'record.lab', 'view')).toBe(true);
    expect(can(labtech.perms, 'location', 'view')).toBe(true);

    const secretary = SEED_ROLES.find((r) => r.key === 'secretary')!;
    expect(can(secretary.perms, 'patient', 'view')).toBe(true);
    expect(can(secretary.perms, 'appointment', 'view')).toBe(true);
    expect(can(secretary.perms, 'location', 'view')).toBe(true);
  });

  it('3. Un utilisateur sans permissions (session expirée ou vide) n’a aucun accès', () => {
    const emptyPerms: string[] = [];
    expect(can(emptyPerms, 'patient', 'view')).toBe(false);
    expect(can(emptyPerms, 'appointment', 'view')).toBe(false);
    expect(can(emptyPerms, 'record.lab', 'view')).toBe(false);
    expect(can(emptyPerms, 'admin', 'view')).toBe(false);
    expect(can(undefined, 'patient', 'view')).toBe(false);
  });

  it('4. L’administrateur avec joker "*" a accès à tous les modules', () => {
    const admin = SEED_ROLES.find((r) => r.key === 'admin')!;
    expect(can(admin.perms, 'patient', 'view')).toBe(true);
    expect(can(admin.perms, 'appointment', 'view')).toBe(true);
    expect(can(admin.perms, 'record.lab', 'view')).toBe(true);
    expect(can(admin.perms, 'admin', 'view')).toBe(true);
    expect(can(admin.perms, 'any_future_module', 'view')).toBe(true);
  });
});
