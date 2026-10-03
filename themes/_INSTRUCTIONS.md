# Système de thèmes externes

Chaque thème est un dossier `/themes/<nom-du-theme>/` :

```
themes/
└── mon-theme/
    ├── theme.json   (obligatoire — manifest validé par Zod, cf. docs/07-I18N-THEMES.md)
    ├── styles.css   (optionnel — surcharges CSS, variables par défaut sinon)
    ├── scripts.js   (optionnel — UNIQUEMENT si le thème est approuvé/signé par un admin)
    └── assets/…     (images, logos…)
```

## Règles

1. **Découverte automatique** au démarrage + bouton « Rescanner » (admin > Thèmes).
2. **Validation stricte** du `theme.json` : manifest invalide → thème ignoré, erreur listée dans le rapport admin, l'application n'est pas impactée.
3. Les couleurs/variables se déclarent dans `theme.json.variables` (`light` et/ou `dark`) ; elles écrasent les tokens par défaut.
4. `scripts.js` n'est **chargé que si** `manifest.signed === true` et que l'admin a cliqué « Approuver » (sha256 du fichier consigné dans `settings.themes.approved`). Un JS non approuvé n'est jamais injecté.
5. Activation d'un thème = écriture dans `settings.ui.theme` ; toutes les vues s'y conforment (UI + PDF + e-mails via les mêmes tokens).

## Ajouter un thème

Copier `medical-blue/` vers `themes/<nom>/`, éditer, puis « Rescanner » dans l'administration. Upload ZIP pris en charge (admin > Thèmes > Importer) : le ZIP n'est décompressé qu'après vérification de la présence d'un `theme.json` valide et d'une arborescence saine (pas de `..`).
