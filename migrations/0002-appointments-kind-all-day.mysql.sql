-- 0002 (MySQL) — Colonnes appointments.kind et appointments.all_day.
-- --------------------------------------------------------------------------------------------
-- Contexte : le module rendez-vous écrit `kind` (type de RDV : clé de `calendarKinds.kinds`) et
-- `all_day` à la création comme à la modification, mais la table ne possédait pas ces colonnes :
-- l'adaptateur SQL ne sérialise que les colonnes connues → les valeurs étaient SILENCIEUSEMENT
-- PERDUES, et le calendrier retombait toujours sur « consultation » à la relecture.
--
-- MySQL 8 ne connaît pas `ADD COLUMN IF NOT EXISTS` (MariaDB, si) : la migration n'est donc pas
-- déclarée idempotente par le SQL lui-même. Le rejeu est toléré par db:migrate, qui reconnaît
-- « Duplicate column name » comme « déjà appliquée » (voir data/migrations.ts).
-- PostgreSQL a sa propre variante : 0002-appointments-kind-all-day.postgres.sql.
--
-- Le défaut est porté par la COLONNE : les lignes existantes sont backfillées par MySQL lui-même
-- (aucune donnée inventée, aucun rendez-vous laissé sans type).

ALTER TABLE appointments
  ADD COLUMN kind VARCHAR(24) NOT NULL DEFAULT 'consultation'
  COMMENT 'type de RDV — clé de calendarKinds.kinds (réglage admin), référencée par le calendrier';

ALTER TABLE appointments
  ADD COLUMN all_day TINYINT(1) NOT NULL DEFAULT 0
  COMMENT 'rendez-vous journée entière (0/1) — l heure de début reste celle du créneau';

CREATE INDEX ix_appointments_kind ON appointments (kind);
