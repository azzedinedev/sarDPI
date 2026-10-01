# Statut des phases — fait / restant / hypothèses / risques

> Cette application n’est PAS prétendue « sans bugs » : chaque phase liste son état réel, vérifié
> par `npm run typecheck`, `npm test` (34 tests) et un parcours API réel sur la démo seedée.

## Phase 1 — Fondations ✅ terminée
**Fait** : monorepo npm workspaces ; design system (tokens, dark mode, densité, `prefers-reduced-motion`,
propriétés logiques RTL dès le départ) ; polices IBM Plex auto-hébergées via `scripts/gen-fonts.mjs`
(sous-ensembles unicode-range, swap, preload, zéro CDN) ; i18n 4 langues (hot-reload, ETag, fallback FR,
rapport de clés manquantes, éditeur admin avec validation JSON) ; thèmes (`theme.json` Zod, approbation
sha256 pour scripts.js, activation sans redémarrage) ; profil pays DZ (58 wilayas, DZD, Africa/Algiers,
weekend ven-sam, CNAS/CASNOS/CNMA, Chifa, NIN, hijri optionnel) ; adaptateurs MySQL (pool, `FOR UPDATE`),
Postgres, JSON (démo), schéma TS → DDL expand-only ; auth JWT access+refresh rotatif httpOnly, argon2id,
AES-256-GCM + rotation de clés, CSRF, anti-brute-force, captcha interne, RBAC `module.action` + jokers ;
audit chaîné ; service de codification (transaction + verrou, jamais caché) ; cache LRU + `cache_versions`
sans Redis ; file de jobs `SKIP LOCKED` ; CrudModule (3 vues, filtres avancés + sauvegardés, bulk,
export CSV/PDF, drawer, historique).
**Restant (mineur)** : adaptateur IndexedDB côté client (offline pur) — le contrat est écrit et l’UI
l’annonce, l’implémentation navigateur est à brancher ; e2e Playwright.
**Hypothèses** : cookie `sardpi_lang` + persistance UI en localStorage ; permissions = liste de chaînes
plates en JSON (pas de table de jointure) — matrice éditée par l’UI admin.
**Risques** : migration des schémas complexes (expand-only = jamais de colonne supprimée/typée à chaud) ;
cache de permissions TTL 60 s → un changement de rôle est effectif ≤ 60 s après le bump (immédiat sur le
même process).

## Phase 2 — Cœur patient ✅ terminée
**Fait** : patients (code `PAT-00001` séquentiel sans année, création sous verrou), fiche réduite +
détaillée, recherche globale (nom, code, téléphone chiffré via index `emergency_phone/ss_number`…
sur SQL ; bornée et audité), wilayas→dairas/communes importables, praticiens avec préfixes MED/DEN/PHR/…
+ n° d’ordre + signature/cachet (assets), lieux avec horaires par jour (weekend pays), historique patient
2 niveaux (timeline réduite + détail JSON), badges patient (QR + Code128 + URL signée), mouvements
`MOV-`, consentements loi 18-07, allergies/antécédents structurés.
**Restant** : fusion/dédoublonnage de patients (à concevoir avec audit) ; import CSV patients de masse
(UI existe, mapping à documenter).
**Hypothèses** : âge calculé à la volée (jamais stocké) ; photo via assets (pas de binaire en BD).
**Risques** : la recherche `contains` sur champs chiffrés n’est pas possible en SQL (colonnes `enc`) —
seuls les champs indexés clairs sont cherchables ; documenté dans l’UI.

## Phase 3 — Workflow, agenda, mouvements ✅ terminée
**Fait** : calendrier semaine/jours (RTL, weekend ven-sam grisé, slots selon horaires des lieux),
RDV `RDV-00001`, **vérification de conflit côté serveur** (praticien + lieu, overlap sur `[start,end)`) ;
file d’attente par lieu ; mouvements entrée/sortie/transfert avec statut ; statut de RDV complet
(pending→confirmed→done/cancelled/no_show) ; raccourcis clavier agenda ; notification e-mail optionnelle
à la création (template, désactivée sans SMTP).
**Restant** : plages d’indisponibilité récurrentes ; rappels automatiques (le moteur de jobs est prêt).
**Hypothèses** : fuseau = profil pays (`Africa/Algiers`) ; création de RDV possible sans patient (placeholder) — refusée à la validation.
**Risques** : conflits contrôlés à l’écriture (transaction) mais pas de réservation « temps réel » multi-postes
sans MySQL/Postgres (le mode JSON est mono-poste).

## Phase 4 — Sections médicales configurables ✅ terminée
**Fait** : 14 catégories livrées (LAB, PHA, DIA, CAR, RAD, CON, SPE, GYP, CHI, SOI, ANA, REE, CER, ORD)
**en base, éditables** (couleur, icône, module de permission) ; types d’intervention 100 % déclaratifs
(champs typés, vues, statuts, modèle PDF, token public optionnel) — **aucun code pour ajouter une section** ;
formulaire auto-généré + vue liste/cartes par catégorie ; fiche = code combiné
`{PAT}-{AAAAMMJJ}-{PREFIXE}-{SEQ}` sous verrou ; résultats LAB avec bornes âge/sexe + drapeaux
normal/bas/haut/**critique** (seuils en base, panneau référentiel) ; GED par type (`ANL-000001` etc.,
préfixes et longueurs configurables), versions horodatées + nommage `<CODE>_vN.ext`, upload validé
(magic bytes, taille, sha256) ; imports externes (sources API avec mapping JSON, test 6 s, job `import.source`,
`taken from` traçable).
**Restant** : connecteurs certifiés (labo spécifiques) — le squelette source + mapping est là ;
signature électronique certifiée (actuellement image + hash).
**Hypothèses** : `category_prefix` porté sur la fiche (dénormalisé) pour le routage rapide ; les valeurs LAB
sont typées `dec(14,4)` + `value_txt` (unités non numériques).
**Risques** : une catégorie inactive masque ses fiches côté liste (volontaire) ; supprimer un type déjà
utilisé = soft-delete obligatoire (bloqué par l’UI admin).

## Phase 5 — Ordonnances, PDF, QR ✅ terminée
**Fait** : éditeur d’ordonnance (recherche médicament, DCI/trade, dosage, posologie, durée,
instructions, renouvellements, ligne libre), **contrôle allergies/interactions** (`/prescriptions/check`
→ warnings non bloquants avec motif) ; templates admin (en-tête, pied, colonnes, numérotation) ;
validation → verrouillage + **QR de vérification** (`/verify/:token`, page publique non nominative) ;
rendu PDF par **Puppeteer** (façonnage arabe réel, mêmes polices IBM Plex embarquées, RTL + îlots LTR
pour codes/nombres) ; repli sans Chromium = page d’impression HTML (501 + lien) ; code-barres Code128
(bwip-js) sur badge/documents ; impression de n’importe quelle fiche (`/documents/:code/print`).
**Restant** : ordonnances sécurisées (watermark + code anti-fraude national) hors périmètre ;
signature électronique qualifiée ; envoi e-mail « click-to-print » déjà fonctionnel côté file.
**Hypothèses** : PDF = une page A4 par ordonnance, police IBM Plex (non certifiée « officielle ») ;
le QR encode `{APP_URL}/verify/{token}` — l’admin doit définir APP_URL en production.
**Risques** : Chromium absent → 501 contrôlé (jamais de crash) ; le façonnage dépend des versions de
Chromium (lockfile + test d’échappement inclus dans `tests/pdf.test.ts`).

## Phase 6 — Communications & administration ✅ terminée
**Fait** : SMTP (nodemailer) + **historique complet** `MSG-00001` (statut, erreurs, retries, template,
langue du patient, variable d’aperçu), templates 4 langues (reset, RDV, notif fiche), quotas/anti-abus ;
rappel : **aucune donnée médicale dans le sujet** — vérifié par le schéma d’envoi ; centre d’administration :
hub + utilisateurs (reset de mot de passe dédié audité), **matrice rôles×modules×actions** avec cache invalidé,
paramètres (13 sections Zod + aperçu codification live + édition JSON native), traductions (chaud + rapport),
thèmes (scan/approbation/édition), base de données (test + bascule à chaud avec rollback, migration,
export/import JSON portatif), système (jobs retry/purge, audit + vérification de chaîne, sauvegardes
gzip + rétention + cron interne), sources externes (test/run) ; **pays : un JSON à déposer, zéro code**.
**Restant** : facturation/tiers-payant complet (Chifa) — les champs existent, le module de télédéclaration
est hors périmètre v1 ; e-signature qualifiée ; module Électron packagé.
**Hypothèses** : backups = gzip applicatif chiffrable ; l’export JSON n’est pas un dump MySQL (format
sarDPI portatif `db.import`).
**Risques** : bascule d’adaptateur à chaud = redémarrage logique du pool — éviter en pleine charge ;
import JSON = destructif (réservé démo, averti dans l’UI).

## Critères mesurables (§11) — état
- p95 < 300 ms sur lectures cachées : **non mesuré en conditions de charge** (pas de harnais de perf
  dans cette session) — architecture pensée pour (LRU + ETag + no-store côté privé + index sur toutes FK) ;
  le harness k6/playwright reste à faire.
- 60 fps animations : Respecte `prefers-reduced-motion`, animations CSS/framer sur transform/opacity uniquement.
- pm2 zero-downtime reload : config fournie (`config/pm2.config.cjs`) — à valider sur un serveur réel.
- Zéro clé brute affichée : dictionnaires complets pour toutes les clés utilisées (vérifié par balayage
  des écrans + fusion fallback FR), le rapport admin capte les écôts runtime.
- « Sans Redis ni cloud obligatoire » : vérifié — la démo tourne intégralement en local au-dessus.
