# sarDPI — Dossier Patient Informatisé (mini-EMR) pour l’Algérie

Application **on-premise-first** (loi 18-07) : Next.js 15 + TypeScript strict, MySQL par défaut,
adapteurs **Postgres / JSON / localStorage / IndexedDB** en complément, i18n **ar (RTL) / fr / es / en**,
thèmes dynamiques, codification métier paramétrable, ordonnances PDF (façonnage arabe via Puppeteer),
QR/codes-barres avec liens de vérification signés, file de tâches **sans Redis**.

## Démarrage express (démo locale, 0 dépendance externe)

```bash
npm install          # workspaces : apps/web + packages/shared
npm run fonts        # génère public/fonts (IBM Plex WOFF2 auto-hébergés, zéro CDN)
npm run db:migrate   # initialise data/*.json (adaptateur JSON) — ou le schéma MySQL si DATA_ADAPTER=mysql
npm run seed         # jeu de démo algérien : 58 wilayas, 14 catégories, patients, fiches, stock, RDV…
npm run dev          # http://localhost:3000
```

Connexion de démo (à changer immédiatement) : `admin` / `Admin!2026-dz` — aussi
`dr.merabet`/`Medecin!2026-dz`, `labo`/`Labo!2026-dz`, `accueil`/`Accueil!2026-dz`.
Le mot de passe d’admin peut être imposé via `SARDPI_ADMIN_PASSWORD` avant `npm run seed`.

> **Le seed refuse toute base non vide sans `--force`** ; `--force` n’efface des données que sur les
> adaptateurs démo (JSON/memory). Ne jamais seed en production.

## Lancement via VS Code

1. Ouvrir le dossier racine du monorepo dans VS Code (et non `apps/web`).
2. Extensions recommandées (l’invite en bas à droite les propose) : ESLint, Prettier, Tailwind CSS IntelliSense.
3. Créer `apps/web/.env.local` si besoin : `cp .env.example apps/web/.env.local` puis renseigner `AUTH_SECRET`
   (`openssl rand -hex 32`) et `ENC_KEYS=1:$(openssl rand -hex 32)` pour chiffrer les champs sensibles au repos.
4. **Terminal intégré** (`Ctrl+ù`) : les commandes ci-dessus, ou clic droit sur un script de
   `package.json » Scripts » seed » Run` (VS Code liste les scripts npm).
5. **Tâches** (`Ctrl+Shift+B` / `Terminal » Exécuter la tâche…`) : `Dev server`, `Migrate DB`,
   `Seed démo`, `Tests`, `Lint`, `Build` — cf. `.vscode/tasks.json`.
6. **Débogage** (`F5`) : profil « Seed (debug) » pour déboguer `scripts/seed.ts` avec points d’arrêt
   (vite-node + `--inspect`), profil « Next.js : serveur + client » pour l’app complète
   (voir `docs/DEBUG.md` pour l’attach du client).

## Scripts npm (racine)

| Script | Rôle |
| --- | --- |
| `npm run dev` / `build` / `start` | app Next (API incluse sous `/api/v1`) |
| `npm run db:migrate` | DDL expand-only (jamais de DROP) + `migrations/*.sql` si présents |
| `npm run seed` | démo algérienne 4 langues (`-- --force` en démo seule) |
| `npm run db:export` | export JSON portatif → `backups/` (importable via Admin » Base de données) |
| `npm run locales` | régénère `/locales/{lang}/{ns}.json` depuis `scripts/gen-locales.mjs` (source unique) |
| `npm run fonts` | extrait & sous-ensemble les WOFF2 IBM Plex (latin/arabe/mono) dans `public/fonts` |
| `npm test` | Vitest — critères codification, RBAC, crypto, chaîne d’audit, i18n, adaptateurs, gabarit PDF |
| `npm run typecheck` | `tsc --noEmit` sur tout le monorepo |
| `npm run install:pdf` | installe Puppeteer (Chromium local) pour le rendu PDF arabe fidèle |
| `npm run pm2` | zéro-downtime reload en production (`config/pm2.config.cjs`) |

## Configuration

Tout passe par env (voir `.env.example`) ou **Admin » Paramètres** (13 sections Zod-validées,
aperçu live des codes, base de données à chaud avec test + rollback). Points clés :

- `DATA_ADAPTER=mysql|postgres|json|memory` — `json/memory` = **démo mono-poste uniquement**
  (auto-incrément *émulé* par compteur persisté ; aucune garantie multi-utilisateurs).
- `AUTH_SECRET` (JWT) et `ENC_KEYS` (AES-256-GCM, format rotation `ID:hex64,ID:hex64`) — sans ENC_KEYS,
  les champs sensibles ne sont **pas** chiffrés au repos : l’UI l’affiche explicitement.
- `SMTP_ENABLED=1` + host/port/user/pass — sinon les e-mails restent en file (statut « skipped » visible
  dans Admin » Système).
- Pays : déposer `country-profiles/XX.json` (d’après `_TEMPLATE.json`) — **aucun code à écrire**.

## Sécurité (rappel des invariants)

- Codes métier générés **côté serveur uniquement**, dans une transaction avec `SELECT … FOR UPDATE`
  sur `code_sequences` ; jamais cachés ; jamais réutilisés ; toujours ASCII/LTR (`unicode-bidi: isolate`).
- Liens publics (QR, vérification, fichiers) = **tokens aléatoires signés**, jamais l’id ; chaque accès
  privé est re-vérifié par le RBAC serveur (anti-IDOR).
- JWT access court + refresh rotatif httpOnly ; argon2id ; CSRF double-cookie ; anti-brute force ;
  audit **append-only chaîné par hash** (bouton « vérifier la chaîne » dans l’admin).
- Aucune donnée personnelle dans les caches partagés : réponses privées en `no-store`.

## Limites assumées (v1)

- Le mode JSON/localStorage/IndexedDB est **démo/offline/mono-poste** (documenté partout dans l’UI).
- PDF : sans Puppeteer installé, l’impression passe par la page HTML « Imprimer → Enregistrer en PDF »
  (même gabarit, façonnage arabe géré par le navigateur). `npm run install:pdf` pour le PDF serveur.
- Le module Électron est prévu en squelette (packaging non démarré) ; PWA déjà installable.

## Documentation

- `docs/ARCHITECTURE.md` — arbre du projet, flux, couches, design system.
- `docs/DATABASE.md` — schéma logique (ERD), règle `id` auto-incrément + `code`, `code_sequences`, DDL généré.
- `docs/PHASES.md` — statut détaillé par phase (fait / restant / hypothèses / risques).
- `themes/_INSTRUCTIONS.md` — format d’un thème (theme.json validé Zod, styles.css, scripts.js sur approbation sha256).
