/**
 * SCHÉMA — SOURCE DE VÉRITÉ UNIQUE (TypeScript).
 * ---------------------------------------------------------------------------
 * Chaque table des adaptateurs JSON/memory ET du DDL SQL (generateDDL) provient d'ICI :
 * impossible que les deux mondes divergent. Règles (§ DATABASE.md) :
 *  - id BIGINT AUTO_INCREMENT PK partout (jamais d'UUID technique) ;
 *  - colonne métier `code` UNIQUE, générée CÔTÉ SERVEUR sous transaction + verrou, jamais réutilisée ;
 *  - colonnes suffixées `*_json` = multilingue/structuré ; colonnes de type `enc` = chiffrées AES-256-GCM
 *    (la clé est administrée par ENC_KEYS, la rotation est possible — voir security/crypto.ts) ;
 *  - created_at/updated_at alimentés par l'adaptateur ; soft delete = archived_at (+ active).
 * grammaire des specs de colonne : `type[longueur][,échelle][!][i][u][~défaut]`
 *   ! = NOT NULL, i = indexée, u = UNIQUE, ~défaut (vide ⇒ NULL, CURRENT_TIMESTAMP brut, sinon chaîne échappée).
 */

export type ColKind = 'big' | 'int' | 'str' | 'txt' | 'dt' | 'date' | 'json' | 'bool' | 'dec' | 'enc';

export interface ColSpec {
  name: string;
  kind: ColKind;
  len?: number;
  scale?: number;
  notNull: boolean;
  indexed: boolean;
  unique: boolean;
  /** défaut SQL BRUT (djl — 'CURRENT_TIMESTAMP', '0', 'NULL') */
  def?: string;
  comment?: string;
  raw: string;
}

export interface IndexSpec {
  name: string;
  cols: string[];
  unique?: boolean;
}

export interface TableSpec {
  name: string;
  comment: string;
  cols: ColSpec[];
  indexes?: IndexSpec[];
  /** colonnes couvertes par la recherche plein-texte simplifiée du CrudModule */
  search?: string[];
  /** archived_at ajouté + scope actif/archivé du CRUD */
  softDelete?: boolean;
}

/* ------------------------------------------------------------------ helpers */

const SPEC_RE = /^([a-z]+)(\d+)?(?:,(\d+))?(!?[a-z]*)(?:~([\s\S]*))?$/;

function c(name: string, spec: string, comment?: string): ColSpec {
  const m = SPEC_RE.exec(spec);
  if (!m) throw new Error(`spec de colonne invalide : ${name} « ${spec} »`);
  const kind = m[1] as ColKind;
  const flags = m[4] ?? '';
  const def = m[5];
  return {
    name,
    kind,
    len: m[2] ? Number(m[2]) : undefined,
    scale: m[3] ? Number(m[3]) : undefined,
    notNull: flags.includes('!'),
    indexed: flags.includes('i'),
    unique: flags.includes('u'),
    def: def === undefined ? undefined : def === '' ? 'NULL' : def,
    comment,
    raw: spec,
  };
}

/** id technique — BIGINT AUTO_INCREMENT PRIMARY KEY (JAMAIS d'UUID). */
function pk(): ColSpec {
  return c('id', 'big!u', 'id technique auto-incrémenté — BIGINT PRIMARY KEY');
}

/** code métier unique (préfixe + padding pilotés par l'admin, §4 Codification). */
function code(comment?: string): ColSpec {
  return c('code', 'str48!iu', comment ?? 'code métier UNIQUE — généré côté serveur sous verrou, jamais réutilisé');
}

const tsCols = (): ColSpec[] => [c('created_at', 'dt', 'création (ISO)'), c('updated_at', 'dt', 'dernière modification (ISO)')];

/* ------------------------------------------------------------------ tables */

const TABLE_DEFS: TableSpec[] = [
  {
    name: 'roles',
    comment: 'Rôles applicatifs — permissions = paires module:action (§6 RBAC)',
    cols: [pk(), c('role_key', 'str40!u'), c('name_json', 'json!'), c('perms_json', 'json!'), c('system', 'bool~0', 'rôle natif non supprimable'), c('description', 'txt'), ...tsCols()],
    search: ['role_key'],
  },
  {
    name: 'users',
    comment: 'Comptes — policy mot de passe + verrouillage + TOTP optionnel',
    cols: [
      pk(),
      c('username', 'str40!u'),
      c('email', 'str120!u~', 'NULL autorisé pour comptes techniques'),
      c('full_name', 'str120'),
      c('password_hash', 'str120!', 'argon2id — jamais en clair'),
      c('role_id', 'big!i'),
      c('locale', 'str8~fr'),
      c('theme', 'str40', 'thème validé/signé par l’admin (null = défaut)'),
      c('density', 'str16~comfortable'),
      c('nav', 'str16~sidebar'),
      c('photo_asset_id', 'big'),
      c('must_change_password', 'bool~0'),
      c('failed_attempts', 'int~0'),
      c('locked_until', 'dt'),
      c('last_login_at', 'dt'),
      c('totp_enabled', 'bool~0'),
      c('totp_secret', 'str64', 'base32 — jamais exposé par l’API'),
      c('active', 'bool!~1'),
      ...tsCols(),
    ],
    search: ['username', 'email', 'full_name'],
    softDelete: true,
  },
  {
    name: 'sessions',
    comment: 'Refresh tokens rotatifs — hash uniquement, révocation en cascade',
    cols: [
      pk(),
      c('user_id', 'big!i'),
      c('refresh_hash', 'str64!i', 'sha256 du refresh — le brut ne touche jamais la base'),
      c('replaced_by', 'str64', 'détection de rejeu'),
      c('user_agent', 'str200'),
      c('ip', 'str45'),
      c('expires_at', 'dt!'),
      c('revoked_at', 'dt'),
      ...tsCols(),
    ],
    indexes: [{ name: 'ix_sess_user', cols: ['user_id'] }],
  },
  {
    name: 'api_tokens',
    comment: "Tokens d'intégration (prévu, portails/labos) — prefix visible + hash",
    cols: [pk(), code(), c('name', 'str80!'), c('user_id', 'big!i'), c('token_prefix', 'str12!'), c('token_hash', 'str64!u'), c('scopes_json', 'json'), c('last_used_at', 'dt'), c('expires_at', 'dt'), c('revoked_at', 'dt'), ...tsCols()],
  },
  {
    name: 'verify_tokens',
    comment: 'URLs signées publiques : vérification de fiche/ordonnance, reset mot de passe, diffusion fichier — JAMAIS id',
    cols: [
      pk(),
      c('token', 'str96!u', 'aléatoire 256 bits encodé base64url — imprévisible'),
      c('purpose', 'str24!i', 'verify | reset | file'),
      c('entity_type', 'str24!'),
      c('entity_id', 'big!'),
      c('entity_code', 'str48', 'copie du code métier — lisible sur la page publique'),
      c('expires_at', 'dt!'),
      c('issued_at', 'dt!'),
      c('revoked', 'bool~0'),
      c('meta_json', 'json', '{ category, date, … } strictement non médical'),
      ...tsCols(),
    ],
  },
  {
    name: 'code_sequences',
    comment: 'Compteurs de codes métier — verrou SELECT…FOR UPDATE, jamais mis en cache (§4)',
    cols: [pk(), c('scope', 'str120!i', 'patient:global | record:{id}:{date}:{PFX} | ged:…'), c('prefix', 'str10!'), c('period_key', 'str24!~all'), c('last_value', 'big!~0'), ...tsCols()],
    indexes: [{ name: 'ux_codeseq', cols: ['scope', 'prefix', 'period_key'], unique: true }],
  },
  {
    name: 'cache_versions',
    comment: 'Invalidation inter-processus sans Redis : bump(tag) → version++; les instances comparent',
    cols: [pk(), c('tag', 'str40!u'), c('version', 'big!~0'), ...tsCols()],
  },
  {
    name: 'jobs',
    comment: 'File de jobs en BASE (claim SQL FOR UPDATE SKIP LOCKED / verrou JSON) — backoff exponentiel',
    cols: [
      pk(),
      c('kind', 'str40!i', 'email.send | backup.run | import.source …'),
      c('payload_json', 'json'),
      c('status', 'str16!~queued+i', 'queued | running | done | dead'),
      c('attempts', 'int~0'),
      c('max_attempts', 'int~5'),
      c('next_run_at', 'dt!i'),
      c('last_error', 'txt'),
      c('locked_by', 'str40'),
      c('locked_at', 'dt'),
      ...tsCols(),
    ],
  },
  {
    name: 'audit_log',
    comment: 'Journal infalsifiable — chaîne SHA-256 (prev_hash→hash), réécriture détectée (admin /admin/audit/verify)',
    cols: [
      pk(),
      c('at', 'dt!i'),
      c('actor_id', 'big'),
      c('action', 'str64!i', 'patient.update, record.validate…'),
      c('entity', 'str40!'),
      c('entity_id', 'str40', 'varchar : accepte codes métier et ids'),
      c('ip', 'str45'),
      c('ua', 'str200'),
      c('diff_json', 'json', 'before/after — champs sensibles et secrets rédigés en •'),
      c('prev_hash', 'str64'),
      c('hash', 'str64!i'),
      ...tsCols(),
    ],
    search: ['action', 'entity', 'entity_id'],
  },
  {
    name: 'settings',
    comment: 'Sections de configuration validées au write par leur schéma zod (jamais de crash au read)',
    cols: [pk(), c('key', 'str64!u', 'nom de section (codification, smtp, themes…)'), c('value_json', 'json!'), c('updated_by', 'big'), ...tsCols()],
  },
  {
    name: 'admin_regions',
    comment: 'Wilayas/dairas/communes — les communes s’ajoutent sans coder (import JSON admin)',
    cols: [
      pk(),
      c('code_str', 'str8!iu', 'ex. 16, 1601, 160101'),
      c('name_fr', 'str80!'),
      c('name_ar', 'str80'),
      c('kind', 'str16!i', 'wilaya | daira | commune'),
      c('parent_code', 'str8'),
      c('active', 'bool~1'),
      ...tsCols(),
    ],
    search: ['code_str', 'name_fr', 'name_ar'],
  },
  {
    name: 'drugs',
    comment: 'Référentiel médicaments (nomenclature locale — DCI + spécialités)',
    cols: [
      pk(),
      code(),
      c('dci', 'str120!i', 'dénomination commune internationale'),
      c('trade_name', 'str120!iu'),
      c('form', 'str40', 'comprimé, sirop…'),
      c('dosage', 'str40', '500 mg…'),
      c('pack', 'str60', 'boîte de 16'),
      c('price_dzd', 'dec10,2~0'),
      c('reimbursable', 'bool~0', 'remboursable CNAS/sections'),
      c('atc', 'str10', 'classe ATC — moteur d’interactions'),
      c('note', 'txt'),
      ...tsCols(),
    ],
    search: ['dci', 'trade_name', 'atc'],
    softDelete: true,
  },
  {
    name: 'drug_interactions',
    comment: 'Interactions par paires ATC (sévérité) — contrôlées à la création d’ordonnance',
    cols: [pk(), c('a_atc', 'str10!i'), c('b_atc', 'str10!i'), c('severity', 'str16~moderee'), c('note', 'txt'), ...tsCols()],
    indexes: [{ name: 'ix_dintr', cols: ['a_atc', 'b_atc'] }],
  },
  {
    name: 'stock_items',
    comment: 'Lots en stock par pharmacie/lieu',
    cols: [pk(), c('drug_id', 'big!i'), c('batch', 'str40'), c('expiry', 'date'), c('qty', 'dec10,2~0'), c('location_id', 'big'), ...tsCols()],
    indexes: [{ name: 'ix_stock_drug', cols: ['drug_id', 'batch'] }],
  },
  {
    name: 'stock_moves',
    comment: 'Mouvements (entrée/sortie/ajustement) — delta signé, jamais d’édition directe du qty',
    cols: [pk(), c('drug_id', 'big!i'), c('delta', 'dec10,2!'), c('reason', 'str120'), c('at', 'dt!i'), c('by_user', 'big'), ...tsCols()],
  },
  {
    name: 'lab_panels',
    comment: 'Panneaux d’analyses (NFS, IONN…) — configuration pure, sans code',
    cols: [pk(), c('code', 'str20!u'), c('name_json', 'json!'), c('specimen', 'str40~sang'), c('active', 'bool~1'), ...tsCols()],
    search: ['code'],
    softDelete: true,
  },
  {
    name: 'lab_parameters',
    comment: 'Paramètres d’un panneau : clés stables + bornes de référence/gravité',
    cols: [
      pk(),
      c('panel_id', 'big!i'),
      c('param_key', 'str40!'),
      c('name_json', 'json!'),
      c('unit', 'str16'),
      c('ref_min', 'dec12,4'),
      c('ref_max', 'dec12,4'),
      c('crit_low', 'dec12,4'),
      c('crit_high', 'dec12,4'),
      c('decimals', 'int~2'),
      c('sort_order', 'int~0'),
      ...tsCols(),
    ],
    indexes: [{ name: 'ux_labparam', cols: ['panel_id', 'param_key'], unique: true }],
  },
  {
    name: 'lab_results',
    comment: 'Valeurs rendues par fiche — flag L/N/H recalculé serveur',
    cols: [
      pk(),
      c('record_id', 'big!i'),
      c('parameter_id', 'big'),
      c('param_key', 'str40!'),
      c('value_num', 'dec12,4'),
      c('value_txt', 'str160', 'qualitatifs (positif, négatif…)'),
      c('unit', 'str16'),
      c('ref_min', 'dec12,4'),
      c('ref_max', 'dec12,4'),
      c('flag', 'str8', 'L | N | H (serveur) + CRIT'),
      ...tsCols(),
    ],
  },
  {
    name: 'patients',
    comment: 'Identité patient — champs sensibles chiffrés (type enc), code PAT-xxxxx inaltérable',
    cols: [
      pk(),
      code(),
      c('sex', 'str1!'),
      c('birth_date', 'date!i'),
      c('first_name', 'str60!i'),
      c('last_name', 'str80!i'),
      c('first_name_ar', 'str60'),
      c('last_name_ar', 'str80'),
      c('wilaya_code', 'int'),
      c('daira', 'str80'),
      c('commune', 'str80'),
      c('address', 'enc'),
      c('phone', 'enc'),
      c('emergency_name', 'str80'),
      c('emergency_phone', 'enc'),
      c('emergency_relation', 'str40'),
      c('email', 'enc'),
      c('nin', 'enc', 'NIN — chiffré au repos'),
      c('chifa_number', 'enc', 'n° Chifa — chiffré au repos'),
      c('ss_fund', 'str40'),
      c('ss_number', 'enc'),
      c('having_right', 'bool~0', 'ayant-droit'),
      c('third_party_payer', 'bool~0', 'tiers payant'),
      c('blood_group', 'str8'),
      c('allergies_json', 'json', 'liste — affichée en alerte sur ordonnances'),
      c('antecedents_json', 'json'),
      c('attending_practitioner_id', 'big'),
      c('preferred_locale', 'str8~fr'),
      c('country', 'str2~DZ'),
      c('notes', 'txt'),
      c('consent_json', 'json', 'consentement loi 18-07 : { granted, grantedAt, scopes[] }'),
      c('created_by', 'big'),
      ...tsCols(),
    ],
    search: ['code', 'first_name', 'last_name', 'first_name_ar', 'last_name_ar', 'ss_number', 'emergency_phone'],
    softDelete: true,
  },
  {
    name: 'practitioners',
    comment: 'Exercices — signature/cachet image = assets, apposés sur les PDF validés',
    cols: [
      pk(),
      code("code d'exercice"),
      c('user_id', 'big!i', 'compte associé (null pour exerceants non connectés)'),
      c('title', 'str12~Dr'),
      c('first_name', 'str60!'),
      c('last_name', 'str80!i'),
      c('first_name_ar', 'str60'),
      c('last_name_ar', 'str80'),
      c('speciality_json', 'json'),
      c('phone', 'str24'),
      c('email', 'str120'),
      c('rpps', 'str20', 'registre national des professionnels de santé'),
      c('type_prefix', 'str10~P'),
      c('signature_asset_id', 'big'),
      c('stamp_asset_id', 'big'),
      c('active', 'bool~1'),
      ...tsCols(),
    ],
    search: ['code', 'last_name', 'first_name', 'last_name_ar', 'first_name_ar'],
    softDelete: true,
  },
  {
    name: 'locations',
    comment: 'Lieux de soin (cabinet, labo, salle…) — horaires et capacité pour l’agenda',
    cols: [
      pk(),
      code(),
      c('kind', 'str16!i', 'cabinet | labo | hopital | salle'),
      c('name_json', 'json!'),
      c('address', 'str160'),
      c('building', 'str80'),
      c('floor', 'str24'),
      c('capacity', 'int~1'),
      c('open_hours_json', 'json', 'plage hebdo { "1": [[start,end]], … }'),
      c('wilaya_code', 'int'),
      c('active', 'bool~1'),
      ...tsCols(),
    ],
    search: ['code'],
    softDelete: true,
  },
  {
    name: 'intervention_categories',
    comment: "Catégories d'interventions — préfixe de code partagé avec les fiches",
    cols: [
      pk(),
      c('code', 'str20!u', 'ex. CONSULT, LAB, IMG'),
      c('prefix', 'str10!u', 'préfixe des codes de fiches — 1 category = 1 prefix'),
      c('module', 'str40!', 'module applicatif (record.consultation, record.lab…) — clé de PERMISSION'),
      c('label_json', 'json!'),
      c('color', 'str16'),
      c('icon', 'str32'),
      c('sort_order', 'int~0'),
      c('active', 'bool~1'),
      ...tsCols(),
    ],
    search: ['code', 'prefix'],
    softDelete: true,
  },
  {
    name: 'intervention_types',
    comment: "Types d'intervention 100% configurables : champs, vues, statuts, workflow, PDF (§8)",
    cols: [
      pk(),
      c('code', 'str20!iu~', 'ex. NFS dans LAB'),
      c('name_json', 'json!'),
      c('category_prefix', 'str10!i'),
      c('module', 'str40', 'module parent effectif'),
      c('status_json', 'json', 'machine à états : [{ key, label_json, next: [..] }]'),
      c('fields_json', 'json', 'champs de fiche : [{ key, label_json, type, required, options… }]'),
      c('views_json', 'json', 'modes list/rows/cards + colonnes'),
      c('workflow_json', 'json', 'étapes case du circuit (optionnel)'),
      c('pdf_template', 'str60', 'modèle de document (assets/pdf)'),
      c('perms_json', 'json', 'sur/perms par rôle pour CE type'),
      c('color', 'str16'),
      c('icon', 'str32'),
      c('sort_order', 'int~0'),
      c('active', 'bool~1'),
      ...tsCols(),
    ],
    indexes: [{ name: 'ux_inttype', cols: ['category_prefix', 'code'], unique: true }],
    search: ['code'],
    softDelete: true,
  },
  {
    name: 'medical_records',
    comment: 'Fiche médicale générique pilotée par intervention_types — code combiné PAT-…-DATE-PFX-NN',
    cols: [
      pk(),
      code('ex. LAB-20260930-02-PAT-00007'),
      c('patient_id', 'big!i'),
      c('type_id', 'big!i'),
      c('category_prefix', 'str10!i'),
      c('location_id', 'big'),
      c('act_date', 'date!i', 'date de l’acte (fuseau du profil pays)'),
      c('status', 'str16!~draft+i', 'draft | in_progress | validated | cancelled — workflow du type'),
      c('summary_json', 'json', 'résumé multilingue affiché dans les listes'),
      c('fields_json', 'json', 'valeurs des champs configurés { clé: valeur }'),
      c('icd10_json', 'json', 'codes CIM-10 (tableau)'),
      c('author_user_id', 'big!i'),
      c('validated_by', 'big'),
      c('validated_at', 'dt'),
      c('verify_token', 'str96', 'token public de vérification d’authenticité (QR)'),
      ...tsCols(),
    ],
    search: ['code'],
    softDelete: true,
  },
  {
    name: 'record_practitioners',
    comment: 'Intervenants d’une fiche (rôles) — unicité (fiche, exerceant)',
    cols: [pk(), c('record_id', 'big!i'), c('practitioner_id', 'big!i'), c('role', 'str16~contribute', 'author | contribute | read'), ...tsCols()],
    indexes: [{ name: 'ux_recprac', cols: ['record_id', 'practitioner_id'], unique: true }],
  },
  {
    name: 'ged_documents',
    comment: 'GED — fichiers hors base (storage/), SHA-256 vérifié, versions immuables, code {PRÉFIXE_TYPE}-NNNNNN',
    cols: [
      pk(),
      code('GED-000012 — préfixe = préfixe du type de document'),
      c('type_prefix', 'str10!i'),
      c('patient_id', 'big!i'),
      c('record_id', 'big', 'rattachement optionnel à une fiche'),
      c('title', 'str160'),
      c('tags_json', 'json'),
      c('note', 'txt'),
      c('current_version', 'int~1'),
      c('file_name', 'str160', 'nom d’origine (affichage) — le stockage est un nom opaque'),
      c('file_path', 'str255', 'chemin RELATIF sous storage/ — jamais absolu'),
      c('mime', 'str80'),
      c('size_bytes', 'big~0'),
      c('sha256', 'str64', 'contrôlé à chaque lecture'),
      c('uploaded_by', 'big'),
      ...tsCols(),
    ],
    search: ['code', 'title'],
    softDelete: true,
  },
  {
    name: 'ged_versions',
    comment: 'Versions GED — immuables, numérotées, jamais d’écrasement',
    cols: [
      pk(),
      c('document_id', 'big!i'),
      c('version', 'int!'),
      c('file_name', 'str160'),
      c('file_path', 'str255'),
      c('mime', 'str80'),
      c('size_bytes', 'big~0'),
      c('sha256', 'str64'),
      c('note', 'str255'),
      c('created_by', 'big'),
      ...tsCols(),
    ],
    indexes: [{ name: 'ux_gedver', cols: ['document_id', 'version'], unique: true }],
  },
  {
    name: 'assets',
    comment: 'Fichiers applicatifs légers : photos, signatures, cachets, modèles PDF',
    cols: [
      pk(),
      c('kind', 'str24!i', 'avatar | signature | stamp | pdf-template'),
      c('ref_table', 'str40'),
      c('ref_id', 'big'),
      c('patient_id', 'big'),
      c('practitioner_id', 'big'),
      c('file_name', 'str160'),
      c('file_path', 'str255'),
      c('mime', 'str80'),
      c('size_bytes', 'big~0'),
      c('sha256', 'str64'),
      c('uploaded_by', 'big'),
      ...tsCols(),
    ],
  },
  {
    name: 'prescriptions',
    comment: 'Ordonnances — lignes figées à la création (snapshot), PDF via Chromium (bidi/arabe correct)',
    cols: [
      pk(),
      code('ORD-000123'),
      c('patient_id', 'big!i'),
      c('practitioner_id', 'big!i'),
      c('act_date', 'date!i'),
      c('status', 'str16!~draft+i', 'draft | signed | printed | cancelled'),
      c('notes', 'txt'),
      c('locale', 'str8~fr', 'langue du PDF'),
      c('template_id', 'big'),
      c('refills', 'int~0', 'renouvellements autorisés'),
      c('verify_token', 'str96', 'QR → /verify/:token (aucun id exposé)'),
      c('created_by', 'big'),
      ...tsCols(),
    ],
    search: ['code'],
    softDelete: true,
  },
  {
    name: 'prescription_lines',
    comment: 'Lignes d’ordonnance — snapshot du médicament (insensible aux refontes du référentiel)',
    cols: [
      pk(),
      c('prescription_id', 'big!i'),
      c('seq', 'int!'),
      c('drug_id', 'big'),
      c('trade_name', 'str120'),
      c('dci', 'str120'),
      c('form', 'str40'),
      c('dosage', 'str40'),
      c('pack', 'str60'),
      c('qty', 'dec10,2~1'),
      c('duration_days', 'int'),
      c('posology', 'str255', '1 cp matin et soir…'),
      c('instructions', 'str255'),
      c('reimbursable', 'bool~0'),
      ...tsCols(),
    ],
  },
  {
    name: 'prescription_templates',
    comment: 'Modèles d’ordonnance (lignes pré-remplies) — un seul is_default par créateur',
    cols: [pk(), code("TPL-000003"), c('name', 'str120!'), c('is_default', 'bool~0'), c('config_json', 'json', 'lignes/posologies pré-remplies'), ...tsCols()],
    search: ['name', 'code'],
    softDelete: true,
  },
  {
    name: 'patient_cases',
    comment: 'Dossiers/circuits (case) pilotés par les workflows des types d’intervention',
    cols: [pk(), code('CAS-00004'), c('patient_id', 'big!i'), c('title', 'str160'), c('status', 'str16!~open+i', 'open | closed'), c('current_step', 'str40'), c('opened_at', 'dt'), c('closed_at', 'dt'), ...tsCols()],
    search: ['code', 'title'],
  },
  {
    name: 'case_steps',
    comment: 'Étapes d’un circuit — statut + horodatage, l’ordre suit le workflow configuré',
    cols: [pk(), c('case_id', 'big!i'), c('step_key', 'str40!'), c('seq', 'int!~0'), c('status', 'str16~pending', 'pending | in_progress | done | skipped'), c('planned_at', 'dt'), c('started_at', 'dt'), c('done_at', 'dt'), c('location_id', 'big'), c('practitioners_json', 'json', 'ids praticiens requis'), c('documents_json', 'json', 'codes documents GED requis'), c('note', 'txt'), ...tsCols()],
    indexes: [{ name: 'ux_casestep', cols: ['case_id', 'step_key'], unique: true }],
  },
  {
    name: 'patient_movements',
    comment: 'Déplacements entre lieux (accueil → salle → labo…) — historique de parcours',
    cols: [pk(), code('CPT-000001'), c('patient_id', 'big!i'), c('from_location_id', 'big'), c('to_location_id', 'big'), c('at', 'dt!i'), c('status', 'str16~pending', 'pending | in_transit | arrived'), c('reason', 'str160'), c('by_user', 'big'), c('responsible_practitioner_id', 'big'), ...tsCols()],
  },
  {
    name: 'appointments',
    comment: 'Agenda — conflits détectés serveur avant écriture (chevauchement praticien/lieu)',
    cols: [
      pk(),
      code('RDV-000123'),
      c('patient_id', 'big!i'),
      c('practitioner_id', 'big!i'),
      c('location_id', 'big'),
      c('start_at', 'dt!i'),
      c('end_at', 'dt!i'),
      c('status', 'str16!~scheduled+i', 'scheduled | confirmed | waiting | done | cancelled | noshow'),
      c('reason', 'str160'),
      c('notes', 'txt'),
      c('created_by', 'big'),
      ...tsCols(),
    ],
    search: ['code', 'reason'],
  },
  {
    name: 'history_events',
    comment: 'Fil du patient — récapitulatif traversant toutes les tables, redaction audit-like',
    cols: [
      pk(),
      c('patient_id', 'big!i'),
      c('actor_user_id', 'big'),
      c('kind', 'str24!i', 'profile | record | rx | lab | case | movement | note'),
      c('ref_id', 'big'),
      c('ref_code', 'str48', 'le code métier — repère immuable du document'),
      c('occurred_at', 'dt!i'),
      c('summary_json', 'json', 'une ligne traduite { fr, ar, es, en }'),
      c('detail_json', 'json'),
      ...tsCols(),
    ],
  },
  {
    name: 'email_messages',
    comment: 'Outbox — envois RÉELS uniquement si SMTP activé ; sinon file consultable (skipped)',
    cols: [
      pk(),
      code('MSG-000042'),
      c('to_email', 'str160!'),
      c('to_name', 'str120'),
      c('subject', 'str255'),
      c('body_text', 'txt'),
      c('lang', 'str8'),
      c('status', 'str16!~queued+i', 'queued | sent | failed | skipped'),
      c('error', 'txt'),
      c('sent_at', 'dt'),
      c('patient_id', 'big'),
      c('attachment_asset_id', 'big', 'PDF joint (ordonnance…)'),
      c('created_by', 'big'),
      ...tsCols(),
    ],
    search: ['to_email', 'subject', 'code'],
  },
  {
    name: 'external_sources',
    comment: 'Portails labos/fournisseurs — import planifié ou manuel (mapping admin, sans coder)',
    cols: [
      pk(),
      c('name', 'str120!'),
      c('kind', 'str24!~http', 'http | file'),
      c('base_url', 'str255'),
      c('test_path', 'str255'),
      c('auth_json', 'json', "secret stocké masqué à la lecture (settings.secretKeys)"),
      c('mapping_json', 'json', '{ path, patient_ref, results: [{ field, path, transform? }] }'),
      c('active', 'bool~1'),
      ...tsCols(),
    ],
    search: ['name'],
    softDelete: true,
  },
  {
    name: 'import_runs',
    comment: "Exécutions d'import — traçabilité ligne à ligne",
    cols: [pk(), c('source_id', 'big!i'), c('kind', 'str24~rows'), c('status', 'str16!~running', 'running | done | failed'), c('rows_in', 'int~0'), c('rows_out', 'int~0'), c('error', 'txt'), c('started_at', 'dt'), c('finished_at', 'dt'), ...tsCols()],
  },
];

/* --------------------------------------------------------------- normalisation */

function normalize(t: TableSpec): TableSpec {
  if (t.softDelete && !t.cols.some((x) => x.name === 'archived_at')) t.cols.push(c('archived_at', 'dt', 'soft delete — null = actif'));
  return t;
}

export const TABLES: readonly TableSpec[] = Object.freeze(TABLE_DEFS.map(normalize));

export const TABLE_BY_NAME: ReadonlyMap<string, TableSpec> = new Map(TABLES.map((t) => [t.name, t]));

/* -------------------------------------------------------------------- meta */

export interface TableMeta {
  name: string;
  cols: ReadonlyMap<string, ColSpec>;
  /** toutes les colonnes modifiables par le CRUD (sans id/created_at/updated_at) */
  writable: string[];
  json: Set<string>;
  encrypted: Set<string>;
  dates: Set<string>;
  indexed: Set<string>;
  unique: Set<string>;
  search: Set<string>;
  softDelete: boolean;
  spec: TableSpec;
}

const metaCache = new Map<string, TableMeta>();

export function tableMeta(table: string): TableMeta {
  const hit = metaCache.get(table);
  if (hit) return hit;
  const spec = TABLE_BY_NAME.get(table);
  if (!spec) throw new Error(`table inconnue du schéma : ${table}`);
  const cols = new Map(spec.cols.map((x) => [x.name, x]));
  const meta: TableMeta = {
    name: table,
    cols,
    writable: spec.cols.filter((x) => x.name !== 'id' && x.name !== 'created_at' && x.name !== 'updated_at').map((x) => x.name),
    json: new Set(spec.cols.filter((x) => x.kind === 'json').map((x) => x.name)),
    encrypted: new Set(spec.cols.filter((x) => x.kind === 'enc').map((x) => x.name)),
    dates: new Set(spec.cols.filter((x) => x.kind === 'dt' || x.kind === 'date').map((x) => x.name)),
    indexed: new Set(spec.cols.filter((x) => x.indexed || x.unique || x.name === 'id').map((x) => x.name)),
    unique: new Set(spec.cols.filter((x) => x.unique).map((x) => x.name)),
    search: new Set(spec.search ?? []),
    softDelete: Boolean(spec.softDelete),
    spec,
  };
  metaCache.set(table, meta);
  return meta;
}

/* --------------------------------------------------------------- DDL généré */

function sqlType(col: ColSpec, dialect: string): string {
  switch (col.kind) {
    case 'big':
      return 'BIGINT';
    case 'int':
      return 'INT';
    case 'bool':
      return dialect === 'postgres' ? 'SMALLINT' : 'TINYINT(1)';
    case 'dec':
      return `DECIMAL(${col.len ?? 10},${col.scale ?? 2})`;
    case 'str':
      return `VARCHAR(${col.len ?? 64})`;
    case 'txt':
      return 'TEXT';
    case 'enc':
      return 'TEXT';
    case 'dt':
      return dialect === 'postgres' ? 'TIMESTAMPTZ' : 'DATETIME(3)';
    case 'date':
      return dialect === 'postgres' ? 'DATE' : 'DATE';
    case 'json':
      return dialect === 'postgres' ? 'JSONB' : 'JSON';
  }
}

function quote(name: string, dialect: string): string {
  return dialect === 'postgres' ? `"${name}"` : `\`${name}\``;
}

function defSql(col: ColSpec, dialect: string): string {
  if (col.def === undefined) return '';
  if (col.def === 'CURRENT_TIMESTAMP') return dialect === 'postgres' ? ' DEFAULT CURRENT_TIMESTAMP' : ' DEFAULT CURRENT_TIMESTAMP';
  if (col.def === 'NULL') return ' NULL';
  if (/^-?\d+(\.\d+)?$/.test(col.def)) return ` DEFAULT ${col.def}`;
  return ` DEFAULT '${col.def.replace(/'/g, "''")}'`;
}

/**
 * DDL « expand only » : CREATE TABLE IF NOT EXISTS + index tolérés en double (l'appelant capture les
 * erreurs « déjà existant » — voir admin POST /admin/db/migrate). AUCUN DROP, AUCUNE perte de données.
 * Les commentaires ne contiennent jamais de « ; » (le DDL est splitté sur ce séparateur).
 */
export function generateDDL(dialect: string): string {
  const pg = dialect === 'postgres';
  const parts: string[] = [];
  for (const t of TABLES) {
    const tn = quote(t.name, dialect);
    const lines: string[] = [];
    const after: string[] = []; // index émis en statements séparés
    for (const col of t.cols) {
      if (col.name === 'id') {
        lines.push(pg ? '"id" BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY' : '`id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY');
        continue;
      }
      let s = `${quote(col.name, dialect)} ${sqlType(col, dialect)}`;
      if (col.notNull) s += ' NOT NULL';
      s += defSql(col, dialect);
      if (!pg && col.comment) s += ` COMMENT '${col.comment.replace(/'/g, "''").replace(/;/g, ',')}'`;
      lines.push(s);
      if (col.unique) {
        lines.push(pg ? `UNIQUE (${quote(col.name, dialect)})` : `UNIQUE KEY ${quote(`ux_${t.name}_${col.name}`, dialect)} (${quote(col.name, dialect)})`);
      } else if (col.indexed && col.name !== 'id') {
        if (pg) after.push(`CREATE INDEX IF NOT EXISTS ${quote(`ix_${t.name}_${col.name}`, dialect)} ON ${tn} (${quote(col.name, dialect)})`);
        else lines.push(`KEY ${quote(`ix_${t.name}_${col.name}`, dialect)} (${quote(col.name, dialect)})`);
      }
    }
    for (const ix of t.indexes ?? []) {
      const cols = ix.cols.map((x) => quote(x, dialect)).join(', ');
      if (pg) after.push(`CREATE ${ix.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${quote(ix.name, dialect)} ON ${tn} (${cols})`);
      else if (ix.unique) lines.push(`UNIQUE KEY ${quote(ix.name, dialect)} (${cols})`);
      else lines.push(`KEY ${quote(ix.name, dialect)} (${cols})`);
    }
    let body = `CREATE TABLE IF NOT EXISTS ${tn} (\n  ${lines.join(',\n  ')}\n)`;
    if (!pg) body += ` ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='${t.comment.replace(/'/g, "''").replace(/;/g, ',')}'`;
    parts.push(body, ...after);
  }
  return `${parts.join(';\n')};`;
}
