# Débogage & développement sous VS Code

## Prérequis une fois
1. `npm install` à la **racine** du monorepo (workspaces).
2. `cp .env.example apps/web/.env.local` puis, en dev : renseigner au minimum
   `AUTH_SECRET` (sinon un secret éphémère est généré → les sessions tombent au redémarrage) et
   `ENC_KEYS=1:$(openssl rand -hex 32)` pour tester le chiffrement au repos.
3. `npm run fonts` puis `npm run locales` (régénère `public/fonts` et `/locales` si manquants).

## Lancer / déboguer
- **`Ctrl+Shift+B`** (tâche par défaut) → *Dev server* ; sinon `Terminal » Exécuter la tâche… »…`
  pour *Migrate DB*, *Seed démo*, *Tests*, *Typecheck*, *Build*.
- **`F5`** :
  - *Next.js : serveur + client (dev)* — points d’arrêt dans `src/server/**` (le flag `--inspect` est
    passé via `NODE_OPTIONS`) ; le client Chrome se branche automatiquement si `debugWithChrome` fonctionne,
    sinon F5 suffit pour le serveur.
  - *Seed (debug)* — débogue `scripts/seed.ts` (vite-node sous `--inspect-brk`) : pratique pour pas-à-pas
    la génération de codes (`apps/web/src/server/codes/service.ts`).
  - *Vitest (debug un fichier ouvert)* — ouvre `tests/xxx.test.ts` puis F5.
- Les scripts (`db:migrate`, `seed`, `db:export`) tournent via **vite-node** : ils importent le vrai
  code serveur TS (aucune duplication de logique). Env : ils lisent le shell ; sous VS Code, exportez
  depuis `.env.local` avec `export $(grep -v '^#' apps/web/.env.local | xargs)` si besoin.

## Arborescence à connaître
| Besoin | Fichier |
| --- | --- |
| Ajouter un endpoint | `apps/web/src/server/modules/<domaine>.ts` (+ export dans `routes.ts`) |
| Ajouter une entité CRUD | un `registerCrud({...})` + une page `<CrudModule/>` |
| Changer une table | `apps/web/src/server/data/schema.ts` (puis `npm run db:migrate`) |
| Règle de codification | `apps/web/src/server/codes/service.ts` + section `codification` |
| Ajouter une langue | `languages.json` + dossier `locales/xx/` + entrée dans `scripts/gen-locales.mjs` |
| Ajouter un thème | dossier `themes/<nom>/theme.json` + `styles.css` |
| Traduire l’appli | `scripts/gen-locales.mjs` (source unique) → `npm run locales` |

## Vérifications rapides
```bash
npm run typecheck                 # TS strict, monorepo
npm test                          # 34 tests (codes, RBAC, crypto, audit, i18n, adaptateurs, PDF)
npm run db:migrate && npm run seed -- --force   # repartir d’une démo propre (LOCAL uniquement)
```

## Pièges connus
- `use client` ne doit **jamais** importer `src/server/**` (fs/crypto) — d’où `src/lib/i18n.server.ts`.
- Le routeur API exige le runtime `nodejs` (déjà posé dans `app/api/v1/[...path]/route.ts`).
- En mode JSON, plusieurs serveurs simultanés sur le même `data/` se marchent dessus → mono-processus
  (c’est signalé dans l’UI, bandeau « mode démo »).
- **Port 3000 occupé** : les scripts `dev`/`start` ne forcent plus le port — le CLI Next lit `PORT`
  (et, en dev sans `PORT`, rebascule automatiquement sur 3001, 3002…). Pour imposer : bash/zsh
  `PORT=3100 npm run dev`, PowerShell `$env:PORT='3100'; npm run dev`, cmd `set PORT=3100 && npm run dev`.
  Penser à aligner `APP_URL` (QR codes / liens signés). Pour tuer l’occupant : PowerShell
  `Get-NetTCPConnection -LocalPort 3000 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`,
  Linux/macOS `lsof -ti :3000 | xargs kill`.
