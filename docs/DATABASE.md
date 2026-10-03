# Schéma de données — règles & ERD

## Règles immuables (toutes tables)

1. `id BIGINT AUTO_INCREMENT PRIMARY KEY` **partout** — jamais d’UUID en clé primaire. Les FK sont numériques
   indexées. Les adaptateurs démo (JSON/localStorage/IndexedDB) **émulent** l’auto-incrément avec un compteur
   persisté (`data/<table>.json` → `{auto, rows}`), validé par `tests/adapter.test.ts` ; c’est du mono-poste,
   documenté comme tel.
2. Chaque entité métier porte une colonne `code VARCHAR(48) UNIQUE` (code lisible) **générée uniquement
   côté serveur**, jamais réutilisée, jamais modifiée après création. Les ids ne sortent jamais dans une URL publique.
3. Mouches de cycle de vie : `archived_at` (soft delete), `active` (désactivation), timestamps
   `created_at/updated_at` (+ `created_by` où sensible).
4. Colonnes **`enc`** = chiffrées AES-256-GCM au repos (`ENC_KEYS` avec rotation par key-id, format
   `ENCv1.<kid>.<iv>.<tag>.<ct>`) + masquées dans l’audit. Ex. : `phone`, `email`, `nin`, `chifa_number` (patients),
   `totp_secret` (users).
5. Multilingue : libellés stockés en `*_json` `{fr,ar,es,en}` ; le client résout par `pickLabel(obj, lang)`.
6. Le schéma TypeScript (`apps/web/src/server/data/schema.ts`) est la **source unique** ; `generateDDL()`
   produit le DDL MySQL **et** Postgres (expand-only : `CREATE TABLE IF NOT EXISTS`, jamais de DROP).

## Compteurs de codes — `code_sequences`

```sql
CREATE TABLE code_sequences (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  scope      VARCHAR(80) NOT NULL,   -- 'patient:global' | 'record:PAT-00001:LAB:20260930' | 'ged:ANL' …
  prefix     VARCHAR(10) NOT NULL,   -- 'PAT', 'LAB', 'MED', 'ANL', 'RDV'…
  period_key VARCHAR(20) NOT NULL,   -- 'all' | 'AAAAMMJJ' (fiches & ordonnances : reset quotidien)
  last_value BIGINT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY ux_codeseq (scope, prefix, period_key)
);
```

Allocation (service `codes/service.ts`), **dans la transaction de l’écriture métier** :

```sql
SELECT last_value FROM code_sequences
 WHERE scope=? AND prefix=? AND period_key=? FOR UPDATE;   -- verrouille la ligne (Postgres : FOR UPDATE idem)
UPDATE code_sequences SET last_value=last_value+1, updated_at=NOW() WHERE …;
-- code = préfixe + séparateur + last_value paddé (padding/séparateur configurables via
--   Paramètres » Codification — aperçu live dans l’UI admin)
```

- **Jamais de cache** sur ces compteurs (le cache applicatif est court-circuité pour ce scope) ;
- code **immuable**, non réutilisé même si la ligne est supprimée (testé) ;
- formats : `PAT-00001` (sans année), praticiens `MED-00001` (préfixes MED/DEN/PHR/INF/TLB/RDG/RDL/SEC/ADM/INT),
  GED `<TYPE>-000001` (ANL, RAD, CPT… 6 chiffres par défaut), `LOC-001`, `RDV-00001`, `MOV-00001`, `MSG-00001`,
  fiches & ordonnances combinées `{PREFIXE}-{AAAAMMJJ}-{SEQ}-{CODE_PATIENT}` ex. `LAB-20260930-01-PAT-00001`
  (ancien format émis `{CODE_PATIENT}-{AAAAMMJJ}-{PREFIXE}-{SEQ}` — codes immuables, toujours acceptés en lecture).

## ERD (logique, simplifié)

```mermaid
erDiagram
  users }o--|| roles : "role_id"
  sessions }o--|| users : "user_id"
  patients }o--|| users : "created_by"
  patients {
    bigint id PK
    varchar code UK "PAT-00001"
    date birth_date
    varchar sex
    int wilaya_code "→ admin_regions.code_str"
    text phone_enc "AES-256-GCM"
    text nin_enc
    json allergies_json "freins RX & contrôles"
    json consent_json "loi 18-07"
  }
  practitioners {
    bigint id PK
    varchar code UK "MED-00001"
    varchar type_prefix
  }
  locations { bigint id PK, varchar code UK "LOC-001", json open_hours_json }
  intervention_categories { varchar prefix UK "LAB", varchar module "record.lab", json label_json }
  intervention_types {
    bigint id PK, varchar code UK "LAB_nfs",
    json fields_json "formulaire généré dynamiquement",
    json statuses_json, varchar pdf_template
  }
  medical_records }o--|| patients : "patient_id"
  medical_records }o--|| intervention_types : "type_id"
  medical_records {
    bigint id PK, varchar code UK "LAB-20260930-01-PAT-00001",
    varchar status, json fields_json, json icd10_json,
    varchar verify_token "QR public"
  }
  record_practitioners }o--|| medical_records : "record_id"
  record_practitioners }o--|| practitioners : "practitioner_id"
  lab_results }o--|| medical_records : "record_id"
  lab_results { varchar param_key, decimal value_num, varchar flag "normal|low|high|critical" }
  lab_panels ||--o{ lab_parameters : "panel_id"
  lab_parameters { decimal ref_min "bornes âge/sexe", decimal crit_low "seuil critique" }
  ged_documents ||--o{ ged_versions : "document_id"
  ged_documents { varchar code UK "ANL-000001", varchar type_prefix, varchar file_path }
  prescriptions ||--o{ prescription_lines : "prescription_id"
  prescriptions { varchar code UK "...-ORD-NN", varchar verify_token, varchar status }
  prescription_lines }o--o| drugs : "drug_id"
  drugs { varchar code UK "DRG-000001", decimal price_dzd "remboursement % " }
  drug_interactions }o--|| drugs : "drug_a / drug_b"
  stock_items }o--|| drugs : "drug_id"
  stock_items { varchar batch, int qty, date expiry }
  stock_moves }o--|| drugs : "drug_id"
  appointments }o--|| patients : "patient_id"
  appointments { varchar code UK "RDV-00001", datetime start_at "conflits vérifiés côté serveur" }
  patient_movements { varchar code UK "MOV-00001" }
  history_events }o--|| patients : "patient_id" "timeline réduite + détail JSON"
  verify_tokens { varchar token UK "base64url 22ch", varchar entity_type, json meta_json "non nominatif" }
  audit_log { varchar action, json diff_json "secrets masqués", varchar prev_hash, varchar hash "chaîne sha256" }
  code_sequences { varchar scope, varchar prefix, varchar period_key, bigint last_value "FOR UPDATE, jamais caché" }
  jobs { varchar type, json payload, varchar status "pending|running|done|failed" }
  email_messages { varchar code UK "MSG-00001", varchar status, int attempts }
  external_sources { json auth_json "valeur chiffrée", json mapping_json }
  import_runs }o--|| external_sources : "source_id"
  settings { varchar key UK "section", json value_json "validé Zod" }
  admin_regions { varchar kind "wilaya", varchar code_str "01..58" }
  assets { varchar file_path, varchar sha256 }
  cache_versions { varchar tag, bigint version }
  sessions { varchar refresh_hash "rotation", datetime expires_at }
```

## Points d’intégrité

- `verify_tokens.token` UNIQUE, 128 bits d’entropie, `expires_at` null = permanent pour documents,
  révocable — la page publique n’affiche **jamais** de nom/identifiant, uniquement type/code/date/état.
- `audit_log.hash = sha256(prev_hash, canon(payload))` : altérer une ligne casse `verifyChain()` à l’id exact
  (testé) ; le diff journalisé passe par `redact()` récursive (password/secret/hash/token/totp → `•`).
- `patients.allergies_json` est relue à chaque ordonnance (`/prescriptions/check` → `warnings`).
- Les fichiers (GED, assets) sont hors BD : `storage/` arborescent + `sha256` vérifié à l’upload
  (magic bytes + taille + ext whitelist) ; diffusion par **token signé** `files/:token` (TTL).
