-- 0002 (PostgreSQL) — Colonnes appointments.kind et appointments.all_day.
-- --------------------------------------------------------------------------------------------
-- Même correctif que la variante MySQL : `kind` (type de RDV, clé de `calendarKinds.kinds`) et
-- `all_day` étaient écrits par le module rendez-vous mais absents du schéma → valeurs perdues.
-- PostgreSQL accepte `ADD COLUMN IF NOT EXISTS` : la migration est idempotente par construction,
-- rejouable sans erreur (le migrateur tolère de toute façon « already exists »).

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS kind VARCHAR(24) NOT NULL DEFAULT 'consultation';

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS all_day BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS ix_appointments_kind ON appointments (kind);
