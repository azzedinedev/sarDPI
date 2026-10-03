/**
 * RBAC — matrice module:action appliquée CÔTÉ API (guard) et côté UI (masquage).
 * permission = `${module}.${action}` | `${module}.*` | `*`.
 */
export const MODULES = [
  'patient', 'patient_case', 'movement', 'appointment',
  'record.lab', 'record.pharmacy', 'record.diagnosis', 'record.cardio', 'record.radio',
  'record.consultation', 'record.specialties', 'record.gynped', 'record.surgery',
  'record.care', 'record.anatpath', 'record.reeducation', 'record.certificates',
  'prescription', 'ged', 'practitioner', 'location', 'message', 'drug', 'labref',
  'user', 'role', 'setting', 'codification', 'category', 'interventionType',
  'theme', 'translation', 'job', 'audit', 'licence', 'backup', 'externalImport',
] as const;

export const ACTIONS = ['view', 'create', 'update', 'delete', 'archive', 'export', 'print', 'email', 'pdf', 'validate'] as const;

export type ModuleKey = (typeof MODULES)[number];
export type ActionKey = (typeof ACTIONS)[number];
export type Permission = string; // 'module.action'

/** Vérifie une permission contre une liste (avec jokers). */
export function can(perms: string[] | undefined, module: string, action: ActionKey): boolean {
  if (!perms) return false;
  if (perms.includes('*')) return true;
  return perms.includes(`${module}.${action}`) || perms.includes(`${module}.*`) || perms.includes(`*.${action}`);
}

/** Rôles seed avec matrice de permissions par module. */
export const SEED_ROLES: { key: string; name: { fr: string; ar: string; es: string; en: string }; perms: string[] }[] = [
  {
    key: 'admin',
    name: { fr: 'Administrateur', ar: 'مدير', es: 'Administrador', en: 'Administrator' },
    perms: ['*'],
  },
  {
    key: 'physician',
    name: { fr: 'Médecin', ar: 'طبيب', es: 'Médico', en: 'Physician' },
    perms: [
      'patient.*', 'patient_case.*', 'movement.*', 'appointment.*',
      ...['lab', 'pharmacy', 'diagnosis', 'cardio', 'radio', 'consultation', 'specialties', 'gynped', 'surgery', 'care', 'anatpath', 'reeducation', 'certificates'].map((m) => `record.${m}.*`),
      'prescription.*', 'ged.view', 'ged.create', 'ged.update', 'practitioner.view', 'location.view',
      'message.view', 'message.create', 'drug.view', 'labref.view',
    ],
  },
  {
    key: 'nurse',
    name: { fr: 'Infirmier', ar: 'ممرض', es: 'Enfermero', en: 'Nurse' },
    perms: [
      'patient.view', 'patient_case.view', 'movement.*', 'appointment.view',
      'record.care.*', 'record.lab.view', 'record.consultation.view', 'record.surgery.view',
      'ged.view', 'ged.create', 'prescription.view', 'practitioner.view', 'location.view', 'drug.view',
    ],
  },
  {
    key: 'labtech',
    name: { fr: 'Technicien de laboratoire', ar: 'تقني مختبر', es: 'Técnico de laboratorio', en: 'Lab technician' },
    perms: [
      'patient.view', 'record.lab.*', 'record.anatpath.view', 'ged.view', 'ged.create',
      'appointment.view', 'location.view', 'labref.*', 'message.view',
    ],
  },
  {
    key: 'radiologist',
    name: { fr: 'Radiologue / Radiographe', ar: 'طبيب أشعة', es: 'Radiólogo', en: 'Radiologist' },
    perms: ['patient.view', 'record.radio.*', 'ged.view', 'ged.create', 'appointment.view', 'location.view', 'message.view', 'prescription.view'],
  },
  {
    key: 'pharmacist',
    name: { fr: 'Pharmacien', ar: 'صيدلي', es: 'Farmacéutico', en: 'Pharmacist' },
    perms: ['patient.view', 'record.pharmacy.*', 'drug.*', 'prescription.view', 'prescription.pdf', 'ged.view', 'message.view'],
  },
  {
    key: 'secretary',
    name: { fr: 'Secrétariat / accueil', ar: 'كتابة / استقبال', es: 'Secretaría', en: 'Reception' },
    perms: [
      'patient.view', 'patient.create', 'patient.update', 'patient_case.view', 'patient_case.update',
      'movement.create', 'appointment.*', 'ged.view', 'ged.create', 'practitioner.view', 'location.view',
      'message.*', 'record.consultation.view', 'prescription.view',
    ],
  },
];
