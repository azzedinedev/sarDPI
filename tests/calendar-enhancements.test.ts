import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Améliorations du calendrier & Sécurité des modales', () => {
  it('Dialog et Drawer ont closeOnClickOutside désactivé par défaut pour éviter les fermetures accidentelles', () => {
    const dialogsSrc = fs.readFileSync(path.join(process.cwd(), 'apps/web/src/components/dialogs.tsx'), 'utf-8');
    // Le paramètre par défaut est false
    expect(dialogsSrc).toContain('closeOnClickOutside = false');
    // Le clic sur l'overlay n'exécute onClose que si closeOnClickOutside est explicitement vrai
    expect(dialogsSrc).toContain('onClick={closeOnClickOutside ? onClose : undefined}');
  });

  it('La fiche de rendez-vous intègre la vue de détail avec toutes les informations et actions', () => {
    const calSrc = fs.readFileSync(path.join(process.cwd(), 'apps/web/src/app/(app)/calendar/page.tsx'), 'utf-8');
    // Mode détail supporté
    expect(calSrc).toContain("mode: 'create' | 'edit' | 'detail'");
    expect(calSrc).toContain("curMode === 'detail'");
    // Boutons d'action dans le détail : Modifier, Supprimer, Dossier patient, Consultation
    expect(calSrc).toContain("setCurMode('edit')");
    expect(calSrc).toContain('delMut.mutate()');
    expect(calSrc).toContain('appt.createRecord');
    expect(calSrc).toContain('appt.openPatient');
    // Affichage des informations
    expect(calSrc).toContain('currentAppt.patient_name');
    expect(calSrc).toContain('currentAppt.practitioner_name');
    expect(calSrc).toContain('currentAppt.location_name');
    expect(calSrc).toContain('startTimeFormatted');
    expect(calSrc).toContain('endTimeFormatted');
  });

  it('La fiche de création/modification propose un select autocomplete avec ajout rapide pour patient, lieu et praticien', () => {
    const calSrc = fs.readFileSync(path.join(process.cwd(), 'apps/web/src/app/(app)/calendar/page.tsx'), 'utf-8');
    // Autocompletes présents
    expect(calSrc).toContain('fetchPatients');
    expect(calSrc).toContain('practOptions');
    expect(calSrc).toContain('locOptions');

    // Modales d'ajout rapide connectées
    expect(calSrc).toContain('PatientQuickDialog');
    expect(calSrc).toContain('PractitionerQuickDialog');
    expect(calSrc).toContain('LocationQuickDialog');

    // États d'ouverture des modales rapides
    expect(calSrc).toContain('setQuickPatientOpen(true)');
    expect(calSrc).toContain('setQuickPractOpen(true)');
    expect(calSrc).toContain('setQuickLocOpen(true)');
  });

  it('/appointments/view renvoie les rendez-vous enrichis avec patient_name, practitioner_name et location_name', () => {
    const apptServerSrc = fs.readFileSync(path.join(process.cwd(), 'apps/web/src/server/modules/appointments.ts'), 'utf-8');
    expect(apptServerSrc).toContain('decorateAppointments');
    expect(apptServerSrc).toContain('patient_name:');
    expect(apptServerSrc).toContain('practitioner_name:');
    expect(apptServerSrc).toContain('location_name:');
  });

  it('PopMenu (autocomplete) a un z-index supérieur aux modales pour s’afficher au premier plan', () => {
    const popoverSrc = fs.readFileSync(path.join(process.cwd(), 'apps/web/src/components/popover.tsx'), 'utf-8');
    // PopMenu z-index z-[300] supérieur à Dialog z-[210]
    expect(popoverSrc).toContain('z-[300]');
    expect(popoverSrc).toContain('z-[290]');
  });
});
