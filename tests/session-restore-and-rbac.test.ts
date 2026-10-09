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

  it('5. Le menu de navigation principal et admin réagit à l’arrivée asynchrone des permissions', () => {
    const NAV_MAIN = [
      { key: 'nav.dashboard', href: '/dashboard', module: null },
      { key: 'nav.patients', href: '/patients', module: 'patient' },
      { key: 'nav.calendar', href: '/calendar', module: 'appointment' },
      { key: 'nav.records', href: '/records/CON', module: 'record.consultation' },
      { key: 'nav.lab', href: '/records/LAB', module: 'record.lab' },
      { key: 'nav.pharmacy', href: '/pharmacy', module: 'record.pharmacy' },
      { key: 'nav.prescriptions', href: '/prescriptions', module: 'prescription' },
      { key: 'nav.ged', href: '/documents', module: 'ged' },
      { key: 'nav.locations', href: '/locations', module: 'location' },
      { key: 'nav.messages', href: '/messages', module: 'message' },
    ];
    const NAV_ADMIN = [
      { key: 'nav.admin', href: '/admin', module: 'admin' },
      { key: 'nav.settings', href: '/admin/settings', module: 'admin' },
    ];

    // Au premier rendu (avant que /auth/me ne se résolve) : perms = []
    const emptyPerms: string[] = [];
    const visInitial = NAV_MAIN.filter((n) => !n.module || can(emptyPerms, n.module, 'view'));
    const admInitial = NAV_ADMIN.filter((n) => !n.module || can(emptyPerms, n.module, 'view'));
    expect(visInitial.map((n) => n.key)).toEqual(['nav.dashboard']);
    expect(admInitial).toEqual([]);

    // Dès que /auth/me résout pour admin : toutes les rubriques doivent s'afficher
    const adminPerms = ['*'];
    const visAdmin = NAV_MAIN.filter((n) => !n.module || can(adminPerms, n.module, 'view'));
    const admAdmin = NAV_ADMIN.filter((n) => !n.module || can(adminPerms, n.module, 'view'));
    expect(visAdmin).toHaveLength(10);
    expect(admAdmin).toHaveLength(2);
    expect(visAdmin.map((n) => n.key)).toContain('nav.patients');
    expect(visAdmin.map((n) => n.key)).toContain('nav.calendar');
    expect(visAdmin.map((n) => n.key)).toContain('nav.records');
    expect(visAdmin.map((n) => n.key)).toContain('nav.lab');
    expect(visAdmin.map((n) => n.key)).toContain('nav.pharmacy');
    expect(visAdmin.map((n) => n.key)).toContain('nav.prescriptions');
    expect(visAdmin.map((n) => n.key)).toContain('nav.ged');
    expect(visAdmin.map((n) => n.key)).toContain('nav.locations');
    expect(visAdmin.map((n) => n.key)).toContain('nav.messages');
    expect(admAdmin.map((n) => n.key)).toContain('nav.admin');
    expect(admAdmin.map((n) => n.key)).toContain('nav.settings');

    // Dès que /auth/me résout pour médecin : toutes les rubriques cliniques doivent s'afficher
    const physicianPerms = SEED_ROLES.find((r) => r.key === 'physician')!.perms;
    const visPhysician = NAV_MAIN.filter((n) => !n.module || can(physicianPerms, n.module, 'view'));
    const admPhysician = NAV_ADMIN.filter((n) => !n.module || can(physicianPerms, n.module, 'view'));
    expect(visPhysician).toHaveLength(10);
    expect(admPhysician).toHaveLength(0);

    // Pour secrétaire : patients, agenda, records, ged, lieux, messagerie
    const secretaryPerms = SEED_ROLES.find((r) => r.key === 'secretary')!.perms;
    const visSecretary = NAV_MAIN.filter((n) => !n.module || can(secretaryPerms, n.module, 'view'));
    expect(visSecretary.map((n) => n.key)).toEqual([
      'nav.dashboard',
      'nav.patients',
      'nav.calendar',
      'nav.records',
      'nav.prescriptions',
      'nav.ged',
      'nav.locations',
      'nav.messages',
    ]);
  });
});
