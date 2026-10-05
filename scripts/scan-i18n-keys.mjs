#!/usr/bin/env node
/**
 * scan-i18n-keys.mjs — recherche les clés i18n UTILISÉES mais ABSENTES des fichiers /locales.
 * ---------------------------------------------------------------------------------------
 * Complète le balayage du générateur (gen-locales.mjs) pour les appels que le balayage
 * statique « t('littéral') » ne voit pas :
 *   1. t('littéral') / tc('littéral')             → clé directe (namespace du hook le plus proche) ;
 *   2. t(`famille.${expr}`)                        → famille dynamique (préfixe vérifié) ;
 *   3. t(x.key) où x provient d'un tableau local  → clés littérales des objets `{ key: '…' }`.
 *
 * Sortie : liste « lang/ns/clé » manquante + code retour 1 si au moins une absence.
 * Usage : node scripts/scan-i18n-keys.mjs [--ns=settings]
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const LANGS = ['fr', 'ar', 'es', 'en'];
const args = process.argv.slice(2);
const onlyNs = args.find((a) => a.startsWith('--ns='))?.slice(5);

/** locales/{lang}/{ns}.json → Set de clés */
const dicts = {};
for (const lang of LANGS) {
  for (const f of fs.readdirSync(path.join(ROOT, 'locales', lang))) {
    if (!f.endsWith('.json')) continue;
    dicts[`${lang}/${f.replace(/\.json$/, '')}`] = new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', lang, f), 'utf8'))));
  }
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = [...walk(path.join(ROOT, 'apps/web/src')), ...walk(path.join(ROOT, 'packages/shared/src'))];
const used = new Map(); // `${ns}|${key}` → [fichiers]
const families = new Map(); // `${ns}|${prefix}` → [fichiers]
const add = (map, k, f) => {
  const rel = path.relative(ROOT, f);
  if (map.has(k)) map.get(k).push(rel);
  else map.set(k, [rel]);
};

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  /** liaisons successives `const { t: tc } = useT('ns')` → alias: [{pos, alias, ns}] trié par position */
  const bindings = [];
  for (const m of src.matchAll(/const\s*\{([^}]*)\}\s*=\s*useT\(\s*['"]([a-zA-Z0-9_-]+)['"]\s*\)/g)) {
    for (const part of m[1].split(',')) {
      const mm = part.match(/([A-Za-z0-9_$]+)(?:\s*:\s*([A-Za-z0-9_$]+))?/);
      if (mm) bindings.push({ pos: m.index, alias: mm[2] ?? mm[1], ns: m[2] });
    }
  }
  // appels `alias(...)`  → namespace = dernière liaison de cet alias AVANT l'appel
  const nsAt = (alias, pos) => {
    let best = null;
    for (const b of bindings) if (b.alias === alias && b.pos < pos) best = b;
    return best?.ns ?? null;
  };
  for (const m of src.matchAll(/([A-Za-z0-9_$]+)\(\s*(?:['"]([^'"]+)['"]|`([^`$]*)\$|([A-Za-z0-9_$]+)\.key\s*[,)]|([A-Za-z0-9_$]+)\s*[,)]|\))/g)) {
    const alias = m[1];
    const ns = nsAt(alias, m.index);
    if (!ns) continue;
    if (m[2] !== undefined) add(used, `${ns}|${m[2]}`, file);
    else if (m[3] !== undefined) add(families, `${ns}|${m[3]}`, file);
    else if (m[4] !== undefined) {
      // t(x.key) → toutes les clés littérales `key: '…'` du fichier
      for (const k of src.matchAll(/key:\s*'([^']+)'/g)) add(used, `${ns}|${k[1]}`, file);
    }
  }
  // serveur : t(lang, 'ns', 'clé') / t(lang, 'ns', `préfixe.${…}`)
  for (const m of src.matchAll(/\bt\(\s*[A-Za-z0-9_$.]+\s*,\s*['"]([a-zA-Z0-9_-]+)['"]\s*,\s*(?:['"]([^'"]+)['"]|`([^`$]*)\$)/g)) {
    if (m[2] !== undefined) add(used, `${m[1]}|${m[2]}`, file);
    else add(families, `${m[1]}|${m[3]}`, file);
  }
}

const missing = [];
for (const [nk, where] of used) {
  const [ns, key] = nk.split('|');
  if (onlyNs && ns !== onlyNs) continue;
  for (const lang of LANGS) {
    const d = dicts[`${lang}/${ns}`];
    if (!d || !d.has(key)) missing.push(`${lang}/${ns}/${key}  ← ${[...new Set(where)].join(', ')}`);
  }
}

/**
 * Codes d'erreur levés par le serveur (`new ApiError(422, 'errors.validation')`) : chaque code doit
 * avoir un libellé dans son namespace canonique (errors.* → errors, auth.* → auth), sinon le
 * bandeau/la notification affiche le code brut (« errors.licenseRequired ») — et le client ne le
 * signale pas comme « clé manquante » puisque le repli erreurs est silencieux.
 */
const codes = new Set();
for (const file of walk(path.join(ROOT, 'apps/web/src/server'))) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/new ApiError\(\s*\d+\s*,\s*'([a-zA-Z0-9_.]+)'/g)) codes.add(m[1]);
}
const codeMissing = [];
for (const code of [...codes].sort()) {
  const ns = code.split('.')[0];
  for (const lang of LANGS) if (!dicts[`${lang}/${ns}`]?.has(code)) codeMissing.push(`${lang}/${ns}/${code}`);
}

const famReport = [];
for (const [nf, where] of [...families].sort()) {
  const [ns, prefix] = nf.split('|');
  if (onlyNs && ns !== onlyNs) continue;
  for (const lang of LANGS) {
    const d = dicts[`${lang}/${ns}`];
    if (!d) continue;
    if (![...d].some((k) => k.startsWith(prefix))) famReport.push(`${lang}/${ns}/${prefix}*  ← ${[...new Set(where)].join(', ')}`);
  }
}

if (missing.length) {
  console.log(`Clés utilisées mais ABSENTES (${missing.length}) :`);
  for (const l of missing.sort()) console.log('  ✗ ' + l);
} else {
  console.log('Aucune clé littérale manquante.');
}
if (codeMissing.length) {
  console.log(`\nCodes d'erreur serveur sans libellé (${codeMissing.length}) :`);
  for (const l of codeMissing) console.log('  ✗ ' + l);
} else {
  console.log(`Codes d'erreur serveur : ${codes.size} vérifiés, tous traduits.`);
}
if (famReport.length) {
  console.log(`\nFamilles dynamiques sans aucune clé correspondante (${famReport.length}) :`);
  for (const l of famReport) console.log('  ? ' + l);
}
process.exitCode = missing.length || codeMissing.length ? 1 : 0;
