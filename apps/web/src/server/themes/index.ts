/**
 * MOTEUR DE THÈMES EXTERNES (§9).
 *  - découverte automatique de /themes/<nom>/ au démarrage + « Rescanner » ;
 *  - validation STRICTE du theme.json (Zod) : thème invalide = ignoré + rapport admin, l'app garde le dernier valide ;
 *  - variables CSS injectées par mode (light/dark) + styles.css optionnel ;
 *  - JS de thème : chargé UNIQUEMENT si approuvé par un admin (sha256 consigné dans settings) et isolé (sandbox iframe non requis : pas d'accès au DOM métier — documenté).
 */
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../config';
import { themeManifestZ, type ThemeManifest } from '@sardpi/shared';
import { sha256 } from '../util';
import { cached, bumpTag } from '../cache';
import { getSection } from '../settings';

export interface ThemeIssue {
  dir: string;
  error: string;
}
export interface LoadedTheme {
  manifest: ThemeManifest;
  css: string;
  js: string | null;
  jsApproved: boolean;
  sha256: string;
  dir: string;
}

interface ScanResult {
  themes: LoadedTheme[];
  issues: ThemeIssue[];
  scannedAt: string;
}

function approveList(): string[] {
  // liste des thèmes approuvés stockée dans settings.security? → propre: on la lit depuis settings.général? non :
  // table settings clé 'themes.approved' via la section 'general' serait moche ; on utilise un fichier d'approbation admin.
  try {
    return JSON.parse(fs.readFileSync(path.join(paths.data, 'themes-approved.json'), 'utf8')) as string[];
  } catch {
    return [];
  }
}

export async function approveTheme(name: string, sha: string): Promise<void> {
  const cur = approveList().filter((x) => !x.startsWith(`${name}|`));
  cur.push(`${name}|${sha}`);
  fs.mkdirSync(paths.data, { recursive: true });
  fs.writeFileSync(path.join(paths.data, 'themes-approved.json'), JSON.stringify(cur, null, 2));
  await bumpTag('themes');
}

function isApproved(name: string, sha: string): boolean {
  return approveList().includes(`${name}|${sha}`);
}

/** Scan complet du dossier /themes (validation stricte, jamais de crash). */
export async function scanThemes(force = false): Promise<ScanResult> {
  return cached('themes', 'scan', force ? 1 : 30_000, async () => {
    const issues: ThemeIssue[] = [];
    const themes: ScanResult['themes'] = [];
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(paths.themes, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch (e) {
      issues.push({ dir: paths.themes, error: (e as Error).message });
    }
    for (const dirName of entries) {
      if (dirName.startsWith('_') || dirName.startsWith('.')) continue;
      const dir = path.join(paths.themes, dirName);
      const manifestPath = path.join(dir, 'theme.json');
      try {
        if (!fs.existsSync(manifestPath)) throw new Error('theme.json absent');
        const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
        const parsed = themeManifestZ.safeParse({ ...raw, name: raw.name ?? dirName });
        if (!parsed.success) {
          const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
          throw new Error(`manifeste invalide — ${detail}`);
        }
        const manifest = parsed.data;
        if (manifest.name !== dirName) throw new Error(`name (« ${manifest.name} ») doit correspondre au dossier (« ${dirName} »)`);
        const cssPath = path.join(dir, 'styles.css');
        const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '';
        const jsPath = path.join(dir, 'scripts.js');
        let js: string | null = null;
        let sha = '';
        if (fs.existsSync(jsPath)) {
          const jsRaw = fs.readFileSync(jsPath, 'utf8');
          sha = sha256(jsRaw);
          if (manifest.js === 'scripts.js' && isApproved(manifest.name, sha)) js = jsRaw;
          else issues.push({ dir: dirName, error: 'scripts.js PRÉSENT mais non approuvé — ignoré (admin > Thèmes > Approuver).' });
        }
        themes.push({ manifest, css, js, sha256: sha, dir: dirName, jsApproved: js !== null });
      } catch (e) {
        issues.push({ dir: dirName, error: (e as Error).message });
      }
    }
    return { themes, issues, scannedAt: new Date().toISOString() };
  });
}

/** CSS « variables » du thème actif (léger, ETag côté API). */
export async function activeThemeCss(): Promise<{ name: string; css: string; etag: string }> {
  const [scan, ui] = await Promise.all([scanThemes(), getSection('ui')]);
  const name = String((ui as { theme?: string }).theme ?? 'medical-blue');
  const theme = scan.themes.find((x) => x.manifest.name === name) ?? scan.themes.find((x) => x.manifest.name === 'medical-blue');
  const css = buildCss(theme?.manifest);
  return { name: theme?.manifest.name ?? 'builtin', css: css + '\n' + (theme?.css ?? ''), etag: sha256(css + (theme?.css ?? '')).slice(0, 16) };
}

export function buildCss(manifest?: ThemeManifest): string {
  const light = manifest?.variables?.light ?? {};
  const dark = manifest?.variables?.dark ?? {};
  const vars = (obj: Record<string, string>) =>
    Object.entries(obj)
      .map(([k, v]) => `  ${k}: ${v};`)
      .join('\n');
  const lines: string[] = [];
  lines.push(`:root{color-scheme:light\n${vars(light)}\n${manifest?.accent ? `--c-accent:${manifest.accent};` : ''}}`);
  if (Object.keys(dark).length) lines.push(`html.dark{color-scheme:dark\n${vars(dark)}\n}`);
  return lines.join('\n');
}

/** JS de thème (si approuvé) — à servir dans une balise isolée, jamais eval. */
export async function activeThemeJs(): Promise<string | null> {
  const [scan, ui] = await Promise.all([scanThemes(), getSection('ui')]);
  const name = String((ui as { theme?: string }).theme ?? 'medical-blue');
  return scan.themes.find((x) => x.manifest.name === name)?.js ?? null;
}

export async function rescanThemes(): Promise<void> {
  await bumpTag('themes');
  await scanThemes(true);
}

/** Création de thème depuis l'admin (upload « fichier » ; l'import ZIP complet est phase 6). */
export async function writeTheme(name: string, manifestRaw: unknown, css: string): Promise<ThemeManifest> {
  const parsed = themeManifestZ.parse({ ...(manifestRaw as object), name });
  if (parsed.name !== name) throw new Error('nom du manifeste ≠ nom du dossier');
  const dir = path.join(paths.themes, name);
  if (fs.existsSync(dir)) throw new Error('thème déjà présent');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'theme.json'), JSON.stringify(parsed, null, 2));
  if (css.trim()) fs.writeFileSync(path.join(dir, 'styles.css'), css);
  await rescanThemes();
  return parsed;
}
