#!/usr/bin/env node
/**
 * Copie les WOFF2 auto-hébergées depuis @fontsource (npm, installé en local — aucun CDN runtime)
 * vers apps/web/public/fonts, avec les sous-ensembles unicode-range latin / latin-ext / arabe.
 * À relancer après `npm install` (les polices sont gitignorées : artefacts binaires régénérables).
 */
import { cpSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NM = join(ROOT, 'node_modules');
const OUT = join(ROOT, 'apps/web/public/fonts');
mkdirSync(OUT, { recursive: true });

// source fontsource -> préfixe de destination + graisses + styles requis
const PLAN = [
  { pkg: '@fontsource/ibm-plex-sans', dest: 'ibm-plex-sans', subsets: ['latin', 'latin-ext'], weights: [400, 500, 600, 700], styles: ['normal', 'italic'] },
  { pkg: '@fontsource/ibm-plex-sans-arabic', dest: 'ibm-plex-sans-arabic', subsets: ['arabic'], weights: [400, 500, 600, 700], styles: ['normal'] },
  { pkg: '@fontsource/ibm-plex-mono', dest: 'ibm-plex-mono', subsets: ['latin'], weights: [400, 500], styles: ['normal'] },
];

let copied = 0;
const manifest = [];
for (const p of PLAN) {
  const filesDir = join(NM, p.pkg, 'files');
  const family = p.pkg.replace('@fontsource/', '');
  if (!existsSync(filesDir)) {
    console.error(`✖ ${p.pkg} introuvable — lancez « npm install » d'abord.`);
    process.exitCode = 1;
    continue;
  }
  for (const subset of p.subsets) {
    for (const weight of p.weights) {
      for (const style of p.styles) {
        const src = join(filesDir, `${family}-${subset}-${weight}-${style}.woff2`);
        if (!existsSync(src)) continue;
        const dest = `${p.dest}-${subset}-${weight}${style === 'italic' ? 'i' : ''}.woff2`;
        cpSync(src, join(OUT, dest));
        manifest.push({ file: dest, family, subset, weight, style });
        copied++;
      }
    }
  }
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`✔ ${copied} fichiers WOFF2 dans apps/web/public/fonts (auto-hébergés, preload/unicode-range gérés dans fonts.css)`);
