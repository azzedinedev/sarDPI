-- 0001 — Normalisation des statuts de rendez-vous (ancien vocabulaire → clés canoniques).
-- ---------------------------------------------------------------------------------------
-- Contexte : le schéma et le jeu de démonstration initiaux écrivaient « scheduled », « waiting »
-- et « noshow » dans appointments.status, alors que le reste de l'application (Zod partagé,
-- réglage admin « calendarKinds », écrans calendrier/dossier patient) utilise
-- pending | confirmed | done | cancelled | no_show. Résultat : 422 Unprocessable Entity à
-- l'enregistrement d'un rendez-vous existant (statut refusé par la validation).
--
-- Idempotent et portable (MySQL / PostgreSQL) : rejouable sans effet sur des données déjà propres.
-- Exécuté par `npm run db:migrate` (dossier migrations/, adaptateurs SQL uniquement).

UPDATE appointments SET status = 'pending'   WHERE status = 'scheduled';
UPDATE appointments SET status = 'confirmed' WHERE status = 'waiting';
UPDATE appointments SET status = 'no_show'   WHERE status = 'noshow';
