/**
 * Polices EMBARQUÉES pour les PDF/e-mails : les WOFF2 auto-hébergés sont injectés en base64 dans
 * un @font-face CSS (aucun CDN, aucun fichier externe requis par Puppeteer ni par la page d'impression).
 * Sous-ensembles latin / latin-ext / arabe (unicode-range) conservés — le PDF embarque les mêmes polices que l'app.
 */
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../config';

interface Face {
  family: string;
  file: string;
  weight: number;
  style: 'normal' | 'italic';
  unicode: string;
}

const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT = 'U+0100-02AF,U+0304,U+0308,U+0329,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20CF,U+2113,U+2C60-2C7F,U+A720-A7FF';
const ARABIC = 'U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-08E1,U+08E3-08FF,U+2000-206F,U+FB50-FDFF,U+FE70-FEFF';

const FACES: Face[] = [
  { family: 'IBM Plex Sans', file: 'ibm-plex-sans-latin-400.woff2', weight: 400, style: 'normal', unicode: LATIN },
  { family: 'IBM Plex Sans', file: 'ibm-plex-sans-latin-ext-400.woff2', weight: 400, style: 'normal', unicode: LATIN_EXT },
  { family: 'IBM Plex Sans', file: 'ibm-plex-sans-latin-500.woff2', weight: 500, style: 'normal', unicode: LATIN },
  { family: 'IBM Plex Sans', file: 'ibm-plex-sans-latin-600.woff2', weight: 600, style: 'normal', unicode: LATIN },
  { family: 'IBM Plex Sans', file: 'ibm-plex-sans-latin-700.woff2', weight: 700, style: 'normal', unicode: LATIN },
  { family: 'IBM Plex Sans Arabic', file: 'ibm-plex-sans-arabic-arabic-400.woff2', weight: 400, style: 'normal', unicode: ARABIC },
  { family: 'IBM Plex Sans Arabic', file: 'ibm-plex-sans-arabic-arabic-500.woff2', weight: 500, style: 'normal', unicode: ARABIC },
  { family: 'IBM Plex Sans Arabic', file: 'ibm-plex-sans-arabic-arabic-600.woff2', weight: 600, style: 'normal', unicode: ARABIC },
  { family: 'IBM Plex Sans Arabic', file: 'ibm-plex-sans-arabic-arabic-700.woff2', weight: 700, style: 'normal', unicode: ARABIC },
];

let cached: string | null = null;

export function embeddedFontsCss(): string {
  if (cached) return cached;
  const dir = paths.fonts;
  const rules: string[] = [];
  for (const f of FACES) {
    const p = path.join(dir, f.file);
    let src = '';
    if (fs.existsSync(p)) src = `url("data:font/woff2;base64,${fs.readFileSync(p).toString('base64')}") format("woff2")`;
    else {
      // fichier manquant (npm run fonts non exécuté) : repli système, aucun CDN possible
      src = `local("IBM Plex Sans"), local("Segoe UI")`;
    }
    rules.push(`@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:${f.weight};font-display:swap;src:${src};unicode-range:${f.unicode};}`);
  }
  cached = rules.join('\n');
  return cached;
}

export function fontStack(lang: string): string {
  return lang === 'ar'
    ? "'IBM Plex Sans Arabic','IBM Plex Sans',system-ui,sans-serif"
    : "'IBM Plex Sans','IBM Plex Sans Arabic',system-ui,sans-serif";
}
