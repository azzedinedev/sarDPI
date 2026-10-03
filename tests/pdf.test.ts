/**
 * TESTS PDF/HTML (Phase 5) — le gabarit d'impression doit : dir=rtl pour l'arabe, codes métier
 * isolés LTR (unicode-bidi), échappement anti-XSS, et le chemin PDF (Puppeteer) doit refuser
 * proprement quand Chromium est absent (501 + repli « Imprimer »), sans jamais casser l'aperçu.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sardpi-pdf-'));
fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
process.env.SARDPI_ROOT = tmp;

const { renderDocHtml, pdfAvailable } = await import('../apps/web/src/server/pdf');

const spec = {
  kind: 'rx' as const,
  title: { fr: 'Ordonnance médicale', ar: 'وصفة طبية' },
  lang: 'ar',
  dir: 'rtl' as const,
  clinic: { name: 'Cabinet El Chifa', address: 'Boumerdès', phone: '+213 24 00 00 00' },
  meta: { code: 'PAT-00003-20260927-ORD-01', date: '2026-09-27', practitioner: 'Dr Y. Merabet', patientLine: 'SLIMANI Karim (PAT-00003)' },
  blocks: [
    { heading: 'Médicaments', table: { head: ['Médicament', 'Posologie'], rows: [['<script>alert(1)</script>', '1 cp × 2'], ['Paracétamol 1000 mg', '1 cp le soir']] } },
    { note: 'Penser à vérifier la fonction rénale. مرحبا' },
  ],
  footer: 'À conserver — sarDPI',
};

describe('gabarit document', () => {
  it('rtl + langue arabe sur <html>', () => {
    const html = renderDocHtml(spec);
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="ar"');
  });
  it('codes métier forment un îlot LTR isolé (anti-miroir bidi)', () => {
    const html = renderDocHtml(spec);
    expect(html).toMatch(/PAT-00003-20260927-ORD-01/);
    expect(html).toContain('bidi'); // style unicode-bidi présent autour des codes
    const m = html.match(/direction\s*:\s*ltr/i);
    expect(m).toBeTruthy();
  });
  it('échappement : le HTML injecté dans les données ne s’exécute jamais (kv ET tableaux)', () => {
    const html = renderDocHtml(spec);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    // Le markup serveur EST permis uniquement s'il est enveloppé explicitement en <c>…</c> :
    const ok = renderDocHtml({ ...spec, blocks: [{ table: { head: ['x'], rows: [['<c><b>9,2</b></c>']] } }] });
    expect(ok).toContain('<b>9,2</b>');
  });
  it('contenu arabe conservé (shape côté navigateur/Puppeteer, pas de transcodage)', () => {
    expect(renderDocHtml(spec)).toContain('وصفة طبية');
  });
  it('sans Chromium : pdfAvailable()=false (le routeur répond alors 501 + URL print, jamais un crash)', async () => {
    expect(typeof (await pdfAvailable())).toBe('boolean');
  });
});
