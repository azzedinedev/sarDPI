/**
 * SERVICE PDF — rendu HTML → PDF via PUPPETEER (obligatoire pour le shaping arabe / bidi corrects,
 * cf. cahier des charges ; @react-pdf/renderer est proscrit pour l'arabe).
 * - Puppeteer est OPTIONNEL à l'installation (paquet lourd) : si le binaire est absent, le service renvoie
 *   `null` et les écrans basculent sur la PAGE D'IMPRESSION (même gabarit HTML, « Enregistrer en PDF » côté navigateur)
 *   — l'application n'est jamais bloquée (exigence de disponibilité).
 * - Les polices IBM Plex sont EMBARQUÉES (base64) dans le HTML : rendu identique à l'écran, zéro CDN.
 * - RTL : `dir="rtl"` + pile 'IBM Plex Sans Arabic', chiffres latins ou arabes selon le profil.
 */
import { env } from '../config';
import { embeddedFontsCss, fontStack } from './fonts';
import type { MultiLabel } from '@sardpi/shared';
import { pickLabel } from '@sardpi/shared';
import { createLogger } from '../logger';

const log = createLogger();

export interface DocBlock {
  heading?: string;
  rows?: [string, string][];
  table?: { head: string[]; rows: string[][] };
  note?: string;
  /** contenu brut de confiance (construit par le serveur uniquement — jamais d'utilisateur direct) */
  html?: string;
}

export interface DocSpec {
  kind: 'rx' | 'report' | 'lab' | 'patient' | 'certificate' | 'verify';
  title: MultiLabel | string;
  titleLang?: string;
  subtitle?: string;
  lang: string;
  dir: 'ltr' | 'rtl';
  numbering?: 'latn' | 'arab';
  clinic: { name: string; address?: string; phone?: string; email?: string };
  meta: { code: string; date: string; practitioner?: string; patientLine?: string; extra?: [string, string][] };
  blocks: DocBlock[];
  footer?: string;
  qr?: { svg: string; caption?: string };
  barcode?: string;
  stamp?: { signatureSvgOrImg?: string; stampSvgOrImg?: string; signHere?: boolean };
  colors?: { primary?: string; accent?: string };
  confidentialNote?: string;
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }) as Record<string, string>)[c] as string);
}

const nf = (lang: string, numbering?: 'latn' | 'arab') =>
  new Intl.NumberFormat(numbering === 'arab' ? 'ar-DZ-u-nu-arab' : lang === 'ar' ? 'ar-DZ-u-nu-latn' : lang, { maximumFractionDigits: 3 });

export function escHtml(s: unknown): string {
  return esc(s);
}

export function renderDocHtml(spec: DocSpec): string {
  const dir = spec.dir;
  const primary = spec.colors?.primary ?? '#0e7f8c';
  const accent = spec.colors?.accent ?? '#34c77b';
  const title = typeof spec.title === 'string' ? spec.title : pickLabel(spec.title, spec.lang, 'fr');
  const titleFr = typeof spec.title === 'string' ? null : spec.lang === 'fr' ? null : pickLabel(spec.title, 'fr', 'fr');
  const bilingualTitle = titleFr && titleFr !== title ? `${esc(title)} <span class="alt">· ${esc(titleFr)}</span>` : esc(title);
  const num = nf(spec.lang, spec.numbering);
  const rowsHtml = (rows: [string, string][]) =>
    `<table class="kv">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>`;
  const blocks = spec.blocks
    .map((b) => {
      let inner = '';
      if (b.rows?.length) inner += rowsHtml(b.rows);
      if (b.table?.rows.length) {
        // Cellule = TEXTE (échappé). Markup volontaire du serveur uniquement si explicitement
        // enveloppé dans <c>…</c> (ex. badges de drapeaux LAB) — aucune donnée utilisateur n'emprunte ce canal.
        const cellHtml = (v: string) => (v.startsWith('<c>') && v.endsWith('</c>') ? v.slice(3, -4) : esc(v));
        inner += `<table class="grid"><thead><tr>${b.table.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${b.table.rows
          .map((r) => `<tr>${r.map((cell) => `<td>${cellHtml(cell)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`;
      }
      if (b.note) inner += `<p class="note">${esc(b.note)}</p>`;
      if (b.html) inner += b.html;
      return `${b.heading ? `<h3>${esc(b.heading)}</h3>` : ''}${inner}`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="${esc(spec.lang)}" dir="${dir}">
<head>
<meta charset="utf-8">
<title>${esc(spec.meta.code)} — sarDPI</title>
<style>
${embeddedFontsCss()}
*{box-sizing:border-box}
:root{color-scheme:light}
body{margin:0;padding:16mm 14mm;font-family:${fontStack(spec.lang)};color:#132732;font-size:11.6px;line-height:${spec.lang === 'ar' ? 1.85 : 1.55};background:#fff}
${spec.numbering === 'arab' ? "td,th,.kv td{font-feature-settings:'lnum'}" : ''}
.doc{max-width:186mm;margin:0 auto}
header.hdr{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:2.5px solid ${primary};padding-bottom:10px}
.brand .nm{font-weight:700;font-size:15.5px;color:${primary}}
.brand .co{color:#456;margin-top:2px;font-size:10px;line-height:1.5}
h1{font-size:17px;margin:14px 0 2px;letter-spacing:.2px}
h1 .alt{color:#7c93a0;font-weight:500;font-size:12.5px}
h2{font-size:12.5px;margin:0 0 10px;color:#456;font-weight:600}
h3{font-size:12px;margin:14px 0 6px;color:${primary};text-transform:uppercase;letter-spacing:.6px}
.meta{display:flex;flex-wrap:wrap;gap:10px 26px;background:linear-gradient(135deg,${primary}12,${accent}10);border:1px solid ${primary}33;border-radius:10px;padding:9px 12px;margin:12px 0}
.meta b{font-variant-numeric:tabular-nums}
code,.code{font-family:'IBM Plex Mono',monospace;font-size:11px;unicode-bidi:isolate;direction:ltr;display:inline-block}
table{width:100%;border-collapse:collapse;margin:4px 0 8px}
table.kv th{text-align:start;color:#4b6472;font-weight:600;width:38%;padding:3px 8px 3px 0;vertical-align:top}
table.kv td{padding:3px 0;vertical-align:top}
table.grid th,table.grid td{border:1px solid #d5e3ea;padding:5px 8px;text-align:start;font-size:11px}
table.grid thead th{background:${primary}14;color:#234654}
table.grid tr:nth-child(even) td{background:#f7fbfc}
table.grid td.num{font-family:'IBM Plex Mono',monospace;text-align:end;direction:ltr;unicode-bidi:isolate}
.flag-high{color:#c2410c;font-weight:700}.flag-low{color:#0369a1;font-weight:700}.flag-critical{color:#b91c1c;font-weight:800;background:#fee2e2;padding:0 5px;border-radius:5px}
p.note{white-space:pre-wrap;background:#f4f8fa;border-radius:8px;padding:8px 10px;margin:6px 0}
ul.rx{list-style:none;padding:0;margin:0}
ul.rx li{padding:6px 0;border-bottom:1px dashed #dbe7ec}
ul.rx .dn{font-weight:600}
ul.rx .qty{font-weight:700;color:#0f766e;unicode-bidi:isolate;white-space:nowrap}
ul.rx .ps{color:#3c5665}
footer.ftr{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;margin-top:16px;border-top:1px solid #dbe7ec;padding-top:10px}
.qrbox{text-align:center}
.qrbox .cap{font-size:9px;color:#607d8b;margin-top:3px;max-width:44mm}
.stampbox{text-align:center;min-width:46mm}
.stampbox img{max-height:22mm;max-width:44mm;display:block;margin:0 auto 3px}
.stampbox .sign{border-top:1px solid #94a9b4;width:42mm;margin:26mm auto 3px;text-align:center;color:#607d8b;font-size:9.5px;padding-top:2px}
.conf{font-size:8.6px;color:#7c93a0;text-align:center;margin-top:10px}
@media print{body{padding:6mm 4mm}.doc{max-width:none}@page{size:A4;margin:12mm}}
</style>
</head>
<body>
<div class="doc">
  <header class="hdr">
    <div class="brand">
      <div class="nm">${esc(spec.clinic.name)}</div>
      <div class="co">${esc(spec.clinic.address ?? '')}${spec.clinic.phone ? `<br>Tél : <span class="code">${esc(spec.clinic.phone)}</span>` : ''}${spec.clinic.email ? ` · ${esc(spec.clinic.email)}` : ''}</div>
    </div>
    ${spec.qr ? `<div class="qrbox">${spec.qr.svg}<div class="cap">${esc(spec.qr.caption ?? '')}</div></div>` : ''}
  </header>

  <h1>${bilingualTitle}</h1>
  ${spec.subtitle ? `<h2>${esc(spec.subtitle)}</h2>` : ''}

  <div class="meta">
    <span><b>${esc(spec.lang === 'ar' ? 'الرمز' : 'Code')} :</b> <code>${esc(spec.meta.code)}</code></span>
    <span><b>${esc(spec.lang === 'ar' ? 'التاريخ' : 'Date')} :</b> ${esc(spec.meta.date)}</span>
    ${spec.meta.patientLine ? `<span><b>${esc(spec.lang === 'ar' ? 'المريض' : 'Patient')} :</b> ${esc(spec.meta.patientLine)}</span>` : ''}
    ${spec.meta.practitioner ? `<span><b>${esc(spec.lang === 'ar' ? 'الممارس' : 'Praticien')} :</b> ${esc(spec.meta.practitioner)}</span>` : ''}
    ${(spec.meta.extra ?? []).map(([k, v]) => `<span><b>${esc(k)} :</b> ${esc(v)}</span>`).join('')}
  </div>

  ${blocks}

  <footer class="ftr">
    ${spec.barcode ? `<div class="qrbox"><div>${spec.barcode}</div></div>` : '<div></div>'}
    <div class="stampbox">
      ${spec.stamp?.stampSvgOrImg ? `<img src="${spec.stamp.stampSvgOrImg}" alt="cachet">` : ''}
      ${spec.stamp?.signatureSvgOrImg ? `<img src="${spec.stamp.signatureSvgOrImg}" alt="signature">` : spec.stamp?.signHere ? `<div class="sign">${esc(spec.lang === 'ar' ? 'التوقيع والختم' : 'Signature & cachet')}</div>` : ''}
    </div>
  </footer>
  ${spec.footer ? `<p class="note">${esc(spec.footer)}</p>` : ''}
  <div class="conf">${esc(spec.confidentialNote ?? '')}</div>
</div>
</body>
</html>`;
}

/* --------------------------------------------- rendu PDF via Puppeteer (optionnel) --------------------------------------------- */

type Browser = { newPage(): Promise<any>; close(): Promise<void> }; // eslint-disable-line @typescript-eslint/no-explicit-any
let browserP: Promise<Browser | null> | null = null;

async function getBrowser(): Promise<Browser | null> {
  if (browserP) return browserP;
  browserP = (async () => {
    try {
      // import dynamique : le paquet lourd n'est requis QUE si l'exploitable existe (on-premise light = print view)
      const puppeteer = await import(/* webpackIgnore: true */ 'puppeteer' as string);
      const mod = (puppeteer as { default?: typeof puppeteer }).default ?? puppeteer;
      const launch = (mod as unknown as { launch: (o: object) => Promise<Browser> }).launch;
      const browser = await launch({
        headless: true,
        executablePath: env.puppeteerExecutable || undefined,
        args: ['--no-sandbox', '--font-render-hinting=none', '--disable-dev-shm-usage'],
      });
      return browser;
    } catch (e) {
      log.info({ reason: (e as Error).message.slice(0, 120) }, 'Puppeteer indisponible → repli sur la page d’impression (Ctrl+P → Enregistrer PDF)');
      return null;
    }
  })();
  return browserP;
}

export async function pdfAvailable(): Promise<boolean> {
  return (await getBrowser()) !== null;
}

export async function renderPdf(html: string): Promise<Buffer | null> {
  const browser = await getBrowser();
  if (!browser) return null;
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const buf = await page.pdf({ format: env.pdfFormat as 'A4', printBackground: true, preferCSSPageSize: true });
    return Buffer.from(buf);
  } catch (e) {
    log.error({ err: (e as Error).message }, 'puppeteer pdf');
    return null;
  } finally {
    try {
      await page.close();
    } catch {
      /* noop */
    }
  }
}

export async function closePdfBrowser(): Promise<void> {
  const b = await browserP;
  await b?.close().catch(() => undefined);
  browserP = null;
}

export { num as pdfNum };
const num = (n: number, lang = 'fr') => new Intl.NumberFormat(lang === 'ar' ? 'ar-DZ-u-nu-latn' : lang, { maximumFractionDigits: 3 }).format(n);
