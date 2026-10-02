# Architecture sarDPI

## Principe cardinal

**Une seule app Next 15 (App Router) rend à la fois l’UI et l’API** : `apps/web/src/app/api/v1/[...path]/route.ts`
délègue au routeur interne (`src/server/http/router.ts`). Zéro service externe obligatoire : ni Redis, ni SaaS,
ni CDN (loi 18-07). Runtime API = `nodejs` (fs pour locales/thèmes, drivers BD, crypto, Puppeteer optionnel).

```
sarDPI/
├── apps/web/                     # app unique (UI + API)
│   ├── src/app/(app)/            # écrans authentifiés (patients, records/<module>, calendrier, GED,
│   │                             #  ordonnances, pharmacie+labo, messages, profil, admin/*)
│   ├── src/app/(auth)/           # login, forgot, reset-password, verify/[token] (public)
│   ├── src/app/api/v1/[...path]  # catch-all API → routeur interne (chaîne de middlewares maison)
│   ├── src/components/           # design system (ui.tsx), CrudModule générique, lab-ui, dialogs…
│   ├── src/lib/                  # api client, i18n (client) + i18n.server (SSR), format, stores…
│   ├── src/server/               # tout le backend, par domaine :
│   │   ├── http/                 #   router (auth, CSRF, quotas, audit, licence) + crud.ts (registre générique)
│   │   ├── data/                 #   schema.ts (source unique du schéma) → DDL MySQL/PG, json.ts (démo),
│   │   │                         #   sql.ts (MySql/Postgres), cast.ts (typage + chiffrement colonnes `enc`)
│   │   ├── codes/service.ts      #   génération de codes : transaction + SELECT…FOR UPDATE, jamais de cache
│   │   ├── auth/                 #   jwt (jose), password (argon2id via hash-wasm), totp, guard/RBAC
│   │   ├── security/             #   crypto AES-256-GCM keyring, captcha interne, ratelimit, upload (magic bytes)
│   │   ├── i18n/server.ts        #   lecture /locales, ETag mtime, fallback, rapport clés manquantes — hot reload
│   │   ├── themes/               #   scan /themes, Zod sur theme.json, sha256 d’approbation pour scripts.js
│   │   ├── settings/             #   13 sections typées (general, codification, languages, smtp, ui, gedTypes…)
│   │   ├── cache/ + jobs/        #   LRU in-process + table cache_versions (bump inter-processus) ;
│   │   │                         #   file de jobs en base (FOR UPDATE SKIP LOCKED) — SANS Redis
│   │   ├── storage/              #   fichiers (GED) + tokens de diffusion signés
│   │   ├── pdf/ qr/ mail/        #   gabarit HTML unique (Puppeteer = option), qrcode+bwip-js, SMTP+historique
│   │   └── modules/              #   endpoints par domaine (auth, patients, records, prescriptions,
│   │                             #   pharmacyLab, catalog, ged, appointments, messages, public, admin)
├── packages/shared/              # Zod + types + RBAC (MODULES/ACTIONS/can) + profils — imports front & back
├── locales/{fr,ar,es,en}/*.json  # dictionnaires plats, éditables à chaud (admin > Traductions)
├── country-profiles/*.json       # DZ complet ; ajouter un pays = déposer un JSON (zéro code)
├── themes/<name>/                # theme.json + styles.css (+ scripts.js approuvé sha256 uniquement)
├── scripts/                      # gen-fonts.mjs, gen-locales.mjs (source des traductions),
│                                 # db-migrate.ts, seed.ts, db-export.ts (exécutés par vite-node)
├── tests/                        # Vitest : critères codification, sécurité, i18n, adaptateurs, PDF, audit
├── electron/                     # squelette (hors-ligne desktop — non packagé)
└── docs/                         # ce dossier
```

## Chaîne de requête API (`router.ts`)

`boot idempotent → CORS/rid → parse path → match route (Table<method,prefix>) → auth (cookie refresh OU Bearer)
→ CSRF (double-cookie sur mutations) → quota rate-limit → licence (402 si payante absente) → guard perm
→ validation Zod du corps → handler(tx si code) → audit chaîné → réponse` — les réponses privées sortent en
`no-store` ; les GET référentiels publics ont un `ETag` + cache court ; jamais de PII dans un cache partagé.

## En-têtes de sécurité & CSP à nonce
- **`src/middleware.ts` + `src/lib/csp.ts`** : la Content-Security-Policy est construite PAR REQUÊTE avec
  un nonce frais (`x-nextjs-csp-nonce`) — Next pose l'attribut `nonce=` sur tous ses scripts, y compris les
  scripts INLINE du stream RSC ; un header statique (next.config `headers()`) ne le peut pas et bloquait
  l'hydratation. En DEV la CSP ajoute `'unsafe-inline'` + `ws:`/`wss:` (HMR) ; en PROD elle est stricte :
  `'nonce-…' 'strict-dynamic'`, pas d'`unsafe-inline`. `frame-src` couvre les iframes Turnstile/hCaptcha/reCAPTCHA.
- Le reste des en-têtes (nosniff, XFO SAMEORIGIN, Referrer-Policy same-origin, Permissions-Policy, COOP) vit
  dans `next.config » headers()` ; `no-store` HTML est posé par le middleware, les en-têtes API (no-store +
  CSP-aware) par le routeur applicatif. Le matcher edge exclut `/api/`, `/_next/` et les assets à cache long
  (fonts, icônes) pour ne pas casser leur immutabilité.
- Un `page.tsx` Next n'exporte QUE `default` + config (`dynamic`, `metadata`…) : les sous-composants d'une
  page vivent en fonctions locales ou dans `components/` (sinon `next build` échoue — validé au build CI-like).

## Référentiels médicaux configurables & champs riches

**Groupes sanguins et caisses de sécurité sociale (SS funds)** ne sont pas codés en dur : ce sont des
listes administrables sans code via *Réglages › Référentiels médicaux* (section `medicalRefs`), chacune
composée de `{ code, label: {fr, ar, es, en}, active }`.

- `GET /api/v1/refs/medical` sert les lignes actives ; l'UI (liste patients, filtres, formulaire,
  dossier) affiche le **libellé traduit selon la langue active** alors que seul le `code` (ex. `A+`,
  `CNAS`) est stocké — les libellés restent donc modifiables sans migration.
- La validation serveur (création/édition patient) refuse tout `bloodGroup`/`ssFund` absent de la
  liste active (422) — un code déjà enregistré reste lisible même si la ligne est désactivée ensuite
  (immutabilité des données de santé).
- **Pays du patient** : la liste des pays proposés vient des profils déposés dans
  `/country-profiles/*.json` (`GET /api/v1/refs/countries`, profils `enabled:false` exclus) —
  ajouter un pays = déposer un profil, zéro code.

**Allergies, antécédents et notes** sont des champs **texte enrichi (HTML)** : éditeur léger
(gras/italique/souligné/listes, `RichEditor`) sans dépendance externe, assaini **à la frappe côté
client ET à l'enregistrement côté serveur** (whitelist de balises `b i u em strong ul ol li br p div
span`, attributs et `javascript:` retirés — `sanitizeRichHtml()` dans `@sardpi/shared`, même fonction
à l'affichage : défense en profondeur, aucune donnée médicale ne doit pouvoir porter de HTML hostile).
Le format ancien (liste de chaînes, `["pénicilline", …]`) reste accepté en lecture/écriture ;
`allergyTokens()` normalise les deux formats pour le contrôle allergies↔médicaments des ordonnances.

**Formulaire du patient groupé** : les champs sont organisés par association (Identité,
Localisation, Contact & urgence, Identifiants nationaux, Couverture sociale, Médical, Notes) via la
clé `group` du `FieldDef` du CrudModule — pures sections visuelles, sans impact API.

**Profondeur des menus** : les menus ancrés (colonnes, filtres avancés, actions ligne) sont rendus
dans un **portail `fixed`** (`components/popover.tsx`, z-[200]) : ils ne sont plus rognés par
l'`overflow` des cartes/tableaux ni masqués par les contextes d'empilement créés par le
`backdrop-filter` des surfaces glass, et basculent au-dessus de l'ancre près du bord de viewport.

## CrudModule (une implémentation, toutes les entités)

Côté serveur, `registerCrud(cfg)` fournit liste paginée (tri, recherche globale OR, filtres avancés JSON,
scope actifs/archivés), create/update soft-delete, `/:id/archive|restore|toggle-active`, `/export` (CSV/Excel
via HTML-CSV / PDF via gabarit), `/bulk`, l’audit de chaque écriture, et l’allocation de code optionnelle
(`allocateCode` dans la transaction). Côté client, `<CrudModule props…/>` rend les **3 vues** (liste/lignes/cartes),
le builder de filtres + filtres enregistrés, sélection multiple + actions groupées, drawer créer/éditer
(générateur de champs typés Zod), historique avant/après. Les modules patients, praticiens, lieux, RDV,
mouvements, types/catégories, drogues, panneaux LAB, templates, sources, utilisateurs, rôles… **sont tous**
ce même module configuré.

## Front

- Design system maison (`src/components/ui.tsx` + `globals.css`) : tokens CSS en triplets RGB
  (`--c-*`), dark mode par classe, densité comfort/compact, `prefers-reduced-motion` respecté,
  propriétés **logiques** partout (`ps/pe/is/ie`) → RTL sans double stylesheet.
- Polices IBM Plex Sans / Sans Arabic / Mono auto-hébergées (`npm run fonts`), `font-display: swap`,
  preload critique, sous-ensembles unicode-range — les **mêmes** polices sont embarquées dans les PDF.
- i18n : `useT(ns)` → dict + `t()` + signalement des clés manquantes (batché, visible en admin) ;
  changement de langue sans rechargement complet (préchargement du namespace + cookie + `<html dir>` à chaud).
- Données : TanStack Query (staleTime court + invalidation par tags de bump serveur) et
  TanStack Table pour les grilles ; zustand pour l’auth/store UI.

## Thématisation

`theme.json` validé Zod (sinon refusé sans impact) ; variables CSS injectées dans `<style id="sardpi-theme">`
(activation **sans redémarrage**, SSR cohérent) ; JS de thème ignoré tant que l’admin n’a pas approuvé son
sha256 (bouton dédié) — jamais de script distant.
