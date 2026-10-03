/**
 * Types de lignes partagés (le serveur renvoie ces formes via l'API REST).
 * Convention : id numérique + code lisible sur TOUTES les tables métier.
 */
import type { MultiLabel } from './labels';
import type { FieldDef } from './entities';

export interface BaseRow {
  id: number;
  code: string;
  status?: string | null;
  created_at?: string;
  updated_at?: string;
  archived_at?: string | null;
  created_by?: number | null;
  clinic_id?: number | null;
}

export interface PatientRow extends BaseRow {
  first_name: string;
  last_name: string;
  first_name_ar?: string | null;
  last_name_ar?: string | null;
  birth_date?: string | null;
  sex: 'M' | 'F';
  photo_asset_id?: number | null;
  wilaya_code?: number | null;
  daira?: string | null;
  commune?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  nin?: string | null;
  ss_fund?: string | null;
  ss_number?: string | null;
  chifa_number?: string | null;
  having_right?: 0 | 1 | null;
  third_party_payer?: 0 | 1 | null;
  emergency_name?: string | null;
  emergency_phone?: string | null;
  emergency_relation?: string | null;
  blood_group?: string | null;
  allergies_json?: string | string[] | null;
  antecedents_json?: string | string[] | null;
  attending_practitioner_id?: number | null;
  preferred_locale?: string;
  country?: string;
  notes?: string | null;
  consent_json?: string | null;
}

export interface PractitionerRow extends BaseRow {
  type_prefix: string;
  first_name: string;
  last_name: string;
  first_name_ar?: string | null;
  last_name_ar?: string | null;
  email?: string | null;
  phone?: string | null;
  order_number?: string | null;
  speciality_json?: MultiLabel | null;
  user_id?: number | null;
  signature_asset_id?: number | null;
  stamp_asset_id?: number | null;
  availability?: string | null;
  active?: 0 | 1;
}

export interface LocationRow extends BaseRow {
  kind: string;
  name_json: MultiLabel;
  capacity: number;
  building?: string | null;
  address?: string | null;
  wilaya_code?: number | null;
  open_hours_json?: string | null;
  active?: 0 | 1;
}

export interface CategoryRow extends BaseRow {
  prefix: string;
  module: string;
  color: string;
  icon: string;
  label_json: MultiLabel;
  active?: 0 | 1;
}

export interface InterventionTypeRow extends BaseRow {
  category_prefix: string;
  type_code: string;
  name_json: MultiLabel;
  description_json?: MultiLabel | null;
  fields_json: FieldDef[] | string;
  statuses_json?: string[] | string;
  default_status?: string;
  views_json?: unknown;
  pdf_template?: string;
  require_verify_token?: 0 | 1;
  active?: 0 | 1;
}

export interface MedicalRecordRow extends BaseRow {
  patient_id: number;
  type_id: number;
  category_prefix: string;
  act_date: string;
  status: string;
  summary_json?: MultiLabel | null;
  fields_json?: Record<string, unknown> | string | null;
  icd10_json?: string[] | string | null;
  author_user_id?: number | null;
  validated_at?: string | null;
  validated_by?: number | null;
  verify_token?: string | null;
  location_id?: number | null;
}

export interface GedDocumentRow extends BaseRow {
  type_prefix: string;
  patient_id?: number | null;
  record_id?: number | null;
  title: string;
  tags_json?: string[] | string;
  note?: string | null;
  current_version: number;
  file_name: string;
  file_path: string;
  mime: string;
  size_bytes: number;
  sha256: string;
  uploaded_by?: number | null;
}

export interface PrescriptionRow extends BaseRow {
  patient_id: number;
  practitioner_id: number;
  act_date: string;
  status: string;
  template_id?: number | null;
  locale?: string;
  notes?: string | null;
  refills?: number;
  verify_token?: string | null;
}

export interface PrescriptionLineRow {
  id: number;
  prescription_id: number;
  seq: number;
  drug_id?: number | null;
  dci?: string | null;
  trade_name: string;
  form?: string | null;
  dosage?: string | null;
  quantity: number;
  posology: string;
  duration_days: number;
  instructions?: string | null;
  reimbursable?: 0 | 1 | null;
}

export interface AppointmentRow extends BaseRow {
  patient_id: number;
  practitioner_id?: number | null;
  location_id?: number | null;
  start_at: string;
  end_at: string;
  kind: string;
  status: string;
  notes?: string | null;
  all_day?: 0 | 1;
}

export interface CaseRow extends BaseRow {
  patient_id: number;
  title?: string | null;
  current_step: string;
  status: string;
  opened_at?: string;
  closed_at?: string | null;
}

export interface CaseStepRow {
  id: number;
  case_id: number;
  step_key: string;
  seq: number;
  status: 'todo' | 'in_progress' | 'done' | 'skipped';
  planned_at?: string | null;
  done_at?: string | null;
  location_id?: number | null;
  practitioners_json?: number[] | string;
  documents_json?: string[] | string;
  note?: string | null;
}

export interface MovementRow extends BaseRow {
  patient_id: number;
  from_location_id?: number | null;
  to_location_id: number;
  reason?: string | null;
  status: string;
  at?: string | null;
  responsible_practitioner_id?: number | null;
}

export interface HistoryEventRow {
  id: number;
  patient_id: number;
  kind: string; // record | rx | ged | case | movement | appointment | profile | note
  ref_id?: number | null;
  ref_code?: string | null;
  actor_user_id?: number | null;
  occurred_at: string;
  summary_json?: MultiLabel | null;
  detail_json?: Record<string, unknown> | null;
}

export interface UserRow {
  id: number;
  code: string | null;
  username: string;
  email: string;
  full_name: string;
  role_id: number;
  role_key?: string;
  locale: string;
  theme: string | null;
  density?: string | null;
  nav?: string | null;
  active: 0 | 1;
  totp_enabled?: 0 | 1;
  failed_attempts?: number;
  locked_until?: string | null;
  last_login_at?: string | null;
  created_at?: string;
  photo_asset_id?: number | null;
}

export interface RoleRow {
  id: number;
  role_key: string;
  name_json: MultiLabel;
  perms_json: string[] | string;
  system?: 0 | 1;
}

export interface DrugRow extends BaseRow {
  dci: string;
  trade_name: string;
  form: string | null;
  dosage: string | null;
  pack: string | null;
  reimbursable: 0 | 1;
  refund_rate: number | null;
  price_dzd: number | null;
  atc: string | null;
}

export interface LabParameterRow extends BaseRow {
  panel_code: string;
  param_key: string;
  unit: string | null;
  ref_min: number | null;
  ref_max: number | null;
  crit_low: number | null;
  crit_high: number | null;
  applies_sex: string | null;
  age_min: number | null;
  age_max: number | null;
  name_json: MultiLabel;
}

export interface LabResultRow {
  id: number;
  record_id: number;
  parameter_id: number | null;
  param_key: string;
  value_num: number | null;
  value_txt: string | null;
  unit: string | null;
  ref_min: number | null;
  ref_max: number | null;
  flag: 'normal' | 'low' | 'high' | 'critical';
}

export interface EmailMessageRow {
  id: number;
  code: string;
  to_email: string;
  to_name: string | null;
  subject: string;
  body_text: string;
  status: 'queued' | 'sent' | 'failed' | 'skipped';
  error?: string | null;
  sent_at?: string | null;
  created_at: string;
  patient_id?: number | null;
  attachment_asset_id?: number | null;
  lang?: string;
  created_by?: number | null;
}

export interface JobRow {
  id: number;
  kind: string;
  payload_json: unknown;
  status: 'queued' | 'running' | 'done' | 'failed' | 'dead';
  attempts: number;
  max_attempts: number;
  next_run_at: string;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditRow {
  id: number;
  at: string;
  actor_id: number | null;
  action: string;
  entity: string;
  entity_id: number | null;
  ip: string | null;
  ua: string | null;
  diff_json: unknown;
  prev_hash: string;
  hash: string;
}

export interface SettingRow {
  key: string;
  value_json: unknown;
  updated_at?: string;
  updated_by?: number | null;
}

export interface VerifyTokenRow {
  id: number;
  token: string;
  entity_type: string;
  entity_id: number;
  entity_code: string;
  issued_at: string;
  expires_at: string | null;
  revoked?: 0 | 1;
}

export interface AssetRow extends BaseRow {
  kind: string; // image | pdf | signature | stamp | avatar
  file_name: string;
  file_path: string;
  mime: string;
  size_bytes: number;
  sha256: string;
  patient_id?: number | null;
}
