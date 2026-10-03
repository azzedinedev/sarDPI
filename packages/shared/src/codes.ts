/**
 * Codification métier — source unique des règles (§6 du cahier des charges).
 * Les PRÉFIXES / paddings par défaut sont CONFIGURABLES via settings.codification ;
 * ce fichier fournit le catalogue initial + les fonctions de construction/analyse.
 * Toutes les fonctions sont pures et testées (Vitest) ; la génération réelle du compteur
 * se fait côté serveur dans une transaction avec verrou (SELECT ... FOR UPDATE).
 */
import type { MultiLabel } from './labels';

export type CodeKind = 'patient' | 'record' | 'ged' | 'practitioner' | 'location' | 'movement' | 'appointment' | 'message';

/** Configuration complète de la codification (par défaut + overrides admin). */
export interface CodificationConfig {
  patientPrefix: string; // PAT
  patientPadding: number; // 5
  separator: string; // '-'
  datePattern: 'YYYYMMDD' | 'YYMMDD' | 'DDMMYYYY'; // partie date du code combiné
  recordSeqPadding: number; // 2 (ou 3 si >99 actes le même jour → extension auto)
  gedPadding: number; // 6
  practitionerPadding: number; // 5
  locationPadding: number; // 3
  genericPadding: number; // 5 (rdv, mouvements, messages)
}

export const DEFAULT_CODIFICATION: CodificationConfig = {
  patientPrefix: 'PAT',
  patientPadding: 5,
  separator: '-',
  datePattern: 'YYYYMMDD',
  recordSeqPadding: 2,
  gedPadding: 6,
  practitionerPadding: 5,
  locationPadding: 3,
  genericPadding: 5,
};

/** Catalogue initial des catégories médicales (préfixes uniques 2-5 lettres majuscules). */
export const DEFAULT_CATEGORIES: { prefix: string; module: string; color: string; icon: string; label: MultiLabel }[] = [
  { prefix: 'LAB', module: 'lab', color: '#8b5cf6', icon: 'flask', label: { fr: 'Laboratoire', ar: 'المختبر', es: 'Laboratorio', en: 'Laboratory' } },
  { prefix: 'PHA', module: 'pharmacy', color: '#10b981', icon: 'pill', label: { fr: 'Pharmacie', ar: 'الصيدلية', es: 'Farmacia', en: 'Pharmacy' } },
  { prefix: 'DIA', module: 'diagnosis', color: '#f59e0b', icon: 'check-search', label: { fr: 'Diagnostic', ar: 'التشخيص', es: 'Diagnóstico', en: 'Diagnosis' } },
  { prefix: 'CAR', module: 'cardio', color: '#ef4444', icon: 'heart', label: { fr: 'Cardiologie', ar: 'أمراض القلب', es: 'Cardiología', en: 'Cardiology' } },
  { prefix: 'RAD', module: 'radio', color: '#3b82f6', icon: 'scan', label: { fr: 'Radiologie / Imagerie', ar: 'التصوير الطبي', es: 'Radiología', en: 'Radiology' } },
  { prefix: 'CON', module: 'consultation', color: '#0ea5b7', icon: 'stethoscope', label: { fr: 'Consultations', ar: 'الاستشارات', es: 'Consultas', en: 'Consultations' } },
  { prefix: 'SPE', module: 'specialties', color: '#6366f1', icon: 'microscope', label: { fr: 'Spécialités', ar: 'التخصصات', es: 'Especialidades', en: 'Specialties' } },
  { prefix: 'GYP', module: 'gynped', color: '#ec4899', icon: 'baby', label: { fr: 'Gynéco-obstétrique / Pédiatrie', ar: 'نساء وتوليد / أطفال', es: 'Gine/Obst. / Pediatría', en: 'OB-GYN / Pediatrics' } },
  { prefix: 'CHI', module: 'surgery', color: '#84cc16', icon: 'surgery', label: { fr: 'Chirurgie / Hospitalisation', ar: 'جراحة / استشفاء', es: 'Cirugía / Hospitalización', en: 'Surgery / Inpatient' } },
  { prefix: 'SOI', module: 'care', color: '#14b8a6', icon: 'syringe', label: { fr: 'Soins', ar: 'العلاجات', es: 'Cuidados', en: 'Care' } },
  { prefix: 'ANA', module: 'anatpath', color: '#a855f7', icon: 'tubes', label: { fr: 'Anatomopathologie', ar: 'التشريح المرضي', es: 'Anatomía patológica', en: 'Pathology' } },
  { prefix: 'REE', module: 'reeducation', color: '#22c55e', icon: 'rehab', label: { fr: 'Rééducation / Autres', ar: 'إعادة تأهيل / أخرى', es: 'Reeducación / Otras', en: 'Rehab / Others' } },
  { prefix: 'CER', module: 'certificates', color: '#eab308', icon: 'certificate', label: { fr: 'Certificats & administratif', ar: 'شهادات وإدارة', es: 'Certificados', en: 'Certificates & admin' } },
  { prefix: 'ORD', module: 'prescription', color: '#06b6d4', icon: 'rx', label: { fr: 'Ordonnance', ar: 'وصفة طبية', es: 'Receta', en: 'Prescription' } },
];

/** Types de documents GED : préfixe par type (§6.5). */
export const DEFAULT_GED_TYPES: { prefix: string; label: MultiLabel; path: string }[] = [
  { prefix: 'ADM', label: { fr: 'Pièce d’identité / administratif', ar: 'وثيقة هوية / إداري', es: 'Identidad / administrativo', en: 'ID / admin' }, path: 'admin' },
  { prefix: 'ANL', label: { fr: 'Analyse / résultat laboratoire', ar: 'تحليل / نتيجة مختبر', es: 'Análisis / laboratorio', en: 'Lab result' }, path: 'labs' },
  { prefix: 'IMG', label: { fr: 'Radiographie / imagerie', ar: 'أشعة / تصوير', es: 'Radiografía / imagen', en: 'Imaging' }, path: 'imaging' },
  { prefix: 'ECG', label: { fr: 'ECG / cardiologie', ar: 'تخطيط قلب', es: 'ECG / cardiología', en: 'ECG / cardiology' }, path: 'cardio' },
  { prefix: 'CRM', label: { fr: 'Compte rendu', ar: 'تقرير طبي', es: 'Informe', en: 'Report' }, path: 'reports' },
  { prefix: 'ORD', label: { fr: 'Ordonnance', ar: 'وصفة', es: 'Receta', en: 'Prescription' }, path: 'prescriptions' },
  { prefix: 'CRT', label: { fr: 'Certificat', ar: 'شهادة', es: 'Certificado', en: 'Certificate' }, path: 'certificates' },
  { prefix: 'CST', label: { fr: 'Consentement', ar: 'رضا مستنير', es: 'Consentimiento', en: 'Consent' }, path: 'consents' },
  { prefix: 'COU', label: { fr: 'Courrier / correspondance', ar: 'مراسلات', es: 'Correspondencia', en: 'Correspondence' }, path: 'mail' },
  { prefix: 'DOC', label: { fr: 'Autre', ar: 'أخرى', es: 'Otro', en: 'Other' }, path: 'misc' },
];

/** Types d'intervenants (§6.6) — préfixes distincts des catégories médicales. */
export const DEFAULT_PRACTITIONER_TYPES: { prefix: string; label: MultiLabel }[] = [
  { prefix: 'MED', label: { fr: 'Médecin', ar: 'طبيب', es: 'Médico', en: 'Physician' } },
  { prefix: 'DEN', label: { fr: 'Chirurgien-dentiste', ar: 'جراح أسنان', es: 'Odontólogo', en: 'Dentist' } },
  { prefix: 'PHR', label: { fr: 'Pharmacien', ar: 'صيدلي', es: 'Farmacéutico', en: 'Pharmacist' } },
  { prefix: 'INF', label: { fr: 'Infirmier', ar: 'ممرض', es: 'Enfermero', en: 'Nurse' } },
  { prefix: 'TLB', label: { fr: 'Technicien de laboratoire', ar: 'تقني مختبر', es: 'Técnico de laboratorio', en: 'Lab technician' } },
  { prefix: 'RDG', label: { fr: 'Radiographe', ar: 'تقني تصوير', es: 'Radiólogo técnico', en: 'Radiographer' } },
  { prefix: 'RDL', label: { fr: 'Radiologue', ar: 'طبيب أشعة', es: 'Radiólogo', en: 'Radiologist' } },
  { prefix: 'SEC', label: { fr: 'Secrétariat / accueil', ar: 'كتابة / استقبال', es: 'Secretaría', en: 'Reception' } },
  { prefix: 'ADM', label: { fr: 'Administrateur', ar: 'مدير', es: 'Administrador', en: 'Administrator' } },
  { prefix: 'INT', label: { fr: 'Autre', ar: 'أخرى', es: 'Otro', en: 'Other' } },
];

const pad = (n: number, width: number) => String(n).padStart(Math.max(width, String(n).length), '0');

/** {PAT}-{00001} — s'étend automatiquement au-delà de 99999 (PAT-100000). */
export function buildPatientCode(seq: number, cfg: Pick<CodificationConfig, 'patientPrefix' | 'patientPadding' | 'separator'> = DEFAULT_CODIFICATION): string {
  return `${cfg.patientPrefix}${cfg.separator}${pad(seq, cfg.patientPadding)}`;
}

/** {PRÉFIXE}-{AAAAMMJJ}-{SEQ}-{CODE_PATIENT} — ex. LAB-20260930-01-PAT-00001 (depuis 2026-10 : le préfixe de catégorie en tête, le code patient en fin). */
export function buildRecordCode(
  patientCode: string,
  dateCompact: string,
  catPrefix: string,
  seq: number,
  cfg: Pick<CodificationConfig, 'separator' | 'recordSeqPadding'> = DEFAULT_CODIFICATION,
): string {
  return `${catPrefix}${cfg.separator}${dateCompact}${cfg.separator}${pad(seq, cfg.recordSeqPadding)}${cfg.separator}${patientCode}`;
}

/** {PFX}-{NNNNNN} (GED) ou {PFX}-{NNNNN} (intervenants, lieux…) — même mécanique. */
export function buildSuffixedCode(prefix: string, seq: number, padding: number, separator = '-'): string {
  return `${prefix}${separator}${pad(seq, padding)}`;
}

/** Date locale (fuseau du profil) au format compact du code. */
export function compactDate(d: Date, tz: string, pattern: CodificationConfig['datePattern'] = 'YYYYMMDD'): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const Y = g('year'), M = g('month'), D = g('day');
  switch (pattern) {
    case 'YYMMDD': return Y.slice(2) + M + D;
    case 'DDMMYYYY': return D + M + Y;
    default: return Y + M + D;
  }
}

/** Un préfixe de catégorie/type doit être 2-5 lettres majuscules, unique. */
export const PREFIX_RE = /^[A-Z]{2,5}$/;
/** Code patient : PAT-00001 (préfixe configurable, padding extensible). */
export const PATIENT_CODE_RE = /^[A-Z]{1,6}-\d{4,8}$/;
/** Code de fiche médicale combiné, format courant (padding date et seq souples). */
export const RECORD_CODE_RE = /^[A-Z]{2,5}-\d{6,8}-\d{2,3}-[A-Z]{1,6}-\d{4,8}$/;
/** Ancien format {CODE_PATIENT}-{AAAAMMJJ}-{PRÉFIXE}-{SEQ} — codes immuables déjà émis : restent lisibles (vérification QR, recherche). */
export const RECORD_CODE_LEGACY_RE = /^[A-Z]{1,6}-\d{4,8}-\d{6,8}-[A-Z]{2,5}-\d{2,3}$/;
/** Code suffixé (GED, intervenant, lieu, rdv, message…). */
export const SUFFIX_CODE_RE = /^[A-Z]{2,5}-\d{3,8}$/;

/** Extrait le code patient d'un code de fiche combiné (nouveau format : suffixe ; ancien : préfixe). */
export function patientCodeFromRecord(code: string): string | null {
  const neuve = /^[A-Z]{2,5}-\d{6,8}-\d{2,3}-([A-Z]{1,6}-\d{4,8})$/.exec(code);
  if (neuve) return neuve[1] as string;
  const ancienne = /^(.+?-\d{4,8})-\d{6,8}-[A-Z]{2,5}-\d{2,3}$/.exec(code);
  return ancienne ? (ancienne[1] as string) : null;
}

/** Scope unique du compteur pour chaque famille de codes (table code_sequences). */
export function codeScope(kind: CodeKind, id: string | number | 'global' = 'global', extra = ''): string {
  return [kind, id, extra].filter(Boolean).join(':');
}

/** Clé de période : jamais de remise à zéro pour patient/ged/praticien → 'all'. */
export function periodKey(kind: CodeKind, dateCompact?: string): string {
  if (kind === 'record' && dateCompact) return dateCompact;
  return 'all';
}

/** Validation du préfixe (admin). */
export function isValidPrefix(prefix: string): boolean {
  return PREFIX_RE.test(prefix);
}
