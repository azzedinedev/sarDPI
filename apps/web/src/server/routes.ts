/**
 * ENREGISTREMENT CENTRAL des routes API v1 — un import par module métier.
 * (Chaque module enregistre ses endpoints au chargement ; ordre = priorité en cas d'égalité de spécificité.)
 */
export async function registerRoutes(): Promise<void> {
  const [{ registerAuth }, { registerPatients }, { registerPractitioners }, { registerLocations }, { registerCatalog }, { registerRecords }, { registerGed }, { registerPrescriptions }, { registerAppointments }, { registerWorkflow }, { registerPharmacyLab }, { registerMessages }, { registerAdmin }, { registerPublic }] = await Promise.all([
    import('./modules/auth'),
    import('./modules/patients'),
    import('./modules/practitioners'),
    import('./modules/locations'),
    import('./modules/catalog'),
    import('./modules/records'),
    import('./modules/ged'),
    import('./modules/prescriptions'),
    import('./modules/appointments'),
    import('./modules/workflow'),
    import('./modules/pharmacyLab'),
    import('./modules/messages'),
    import('./modules/admin'),
    import('./modules/public'),
  ]);
  registerAuth();
  registerPatients();
  registerPractitioners();
  registerLocations();
  registerCatalog();
  registerRecords();
  registerGed();
  registerPrescriptions();
  registerAppointments();
  registerWorkflow();
  registerPharmacyLab();
  registerMessages();
  registerAdmin();
  registerPublic();
}
