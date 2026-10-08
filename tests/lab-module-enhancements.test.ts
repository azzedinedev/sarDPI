import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { renderDocHtml, type DocSpec } from '../apps/web/src/server/pdf';

describe('Laboratoire & Fiches médicales — Améliorations Round 8', () => {
  it('1. Les statuts sont traduits correctement dans toutes les langues sans "St Annulé"', () => {
    const root = path.resolve(__dirname, '..');
    const locales = ['fr', 'ar', 'es', 'en'];

    const expectedCancelled: Record<string, string> = {
      fr: 'Annulée',
      ar: 'ملغاة',
      es: 'Cancelada',
      en: 'Cancelled',
    };

    for (const loc of locales) {
      const p = path.join(root, 'locales', loc, 'patient.json');
      expect(fs.existsSync(p)).toBe(true);
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));

      expect(data['records.st.cancelled']).toBe(expectedCancelled[loc]);
      expect(data['records.st.cancelled']).not.toContain('St Annulé');
      expect(data['records.st.cancelled']).not.toContain('st ملغى');

      expect(data['records.st.draft']).toBeTruthy();
      expect(data['records.st.validated']).toBeTruthy();
      expect(data['records.st.in_progress']).toBeTruthy();
    }
  });

  it('2. Les types d’interventions de laboratoire sont définis et présents', () => {
    const root = path.resolve(__dirname, '..');
    const dataPath = path.join(root, 'data', 'intervention_types.json');
    const content = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    const rows = content.rows as Array<{ code: string; category_prefix: string; name_json: Record<string, string> }>;

    const labRows = rows.filter((r) => r.category_prefix === 'LAB');
    expect(labRows.length).toBeGreaterThanOrEqual(5);

    const codes = labRows.map((r) => r.code);
    expect(codes).toContain('LAB_bio');
    expect(codes).toContain('LAB_nfs');
    expect(codes).toContain('LAB_urines');
    expect(codes).toContain('LAB_serologie');
    expect(codes).toContain('LAB_coag');

    // Vérifie le multilinguisme des noms
    const bio = labRows.find((r) => r.code === 'LAB_bio');
    expect(bio?.name_json.fr).toBe('Bilan biologique courant');
    expect(bio?.name_json.ar).toBe('الكيمياء الحيوية العامة');
  });

  it('3. Le menu Lieux (/locations) est présent dans le Shell avec la permission "location"', () => {
    const root = path.resolve(__dirname, '..');
    const shellPath = path.join(root, 'apps/web/src/components/layout/shell.tsx');
    const shellCode = fs.readFileSync(shellPath, 'utf8');

    expect(shellCode).toContain("href: '/locations'");
    expect(shellCode).toContain("module: 'location'");

    const locPagePath = path.join(root, 'apps/web/src/app/(app)/locations/page.tsx');
    const locPageCode = fs.readFileSync(locPagePath, 'utf8');
    expect(locPageCode).toContain("has('location', 'create')");
    expect(locPageCode).toContain("has('location', 'update')");
    expect(locPageCode).toContain("has('location', 'archive')");
    expect(locPageCode).not.toContain("has('locations', 'create')");
  });

  it('4. Le template standard d’impression inclut l’en-tête, les données patient, les détails et la pagination CSS', () => {
    const spec: DocSpec = {
      kind: 'lab',
      title: 'Compte-rendu d’analyses médicales',
      subtitle: 'Hémogramme complet (NFS)',
      lang: 'fr',
      dir: 'ltr',
      clinic: {
        name: 'Laboratoire Central d’Analyses Médicales',
        address: '12 Rue Didouche Mourad, Alger',
        phone: '021 00 00 00',
        email: 'labo@sardpi.dz',
      },
      meta: {
        code: 'LAB-2026-00042',
        date: '08/10/2026 09:30',
        patientLine: 'BENALI SAMIR — PAT-00123',
        practitioner: 'DR. BRAHIMI KARIM',
      },
      blocks: [
        {
          heading: 'Patient',
          rows: [
            ['Nom & Prénom', 'BENALI SAMIR'],
            ['Code patient', 'PAT-00123'],
            ['Date de naissance / Âge', '14/05/1988 (38 ans)'],
            ['Sexe', 'Masculin (M)'],
            ['Téléphone', '0555 12 34 56'],
            ['N° Sécurité sociale / Chifa', '88 1234 5678 90'],
            ['Lieu d’intervention', 'Salle de prélèvement 1'],
            ['Praticien / Équipe', 'DR. BRAHIMI KARIM'],
          ],
        },
        {
          heading: 'Détails & données de l’examen',
          rows: [
            ['Date & heure de prélèvement', '08/10/2026 08:15'],
            ['Tube de prélèvement', 'EDTA (violet)'],
            ['Indication clinique', 'Contrôle bilan anémie'],
          ],
        },
        {
          heading: 'Résultats',
          table: {
            head: ['Paramètre', 'Résultat', 'Unité', 'Valeurs de référence', 'Drapeau'],
            rows: [
              ['HÉMOGLOBINE', '<c><b class="num">13.8</b></c>', 'g/dL', '13.0 – 17.5', '<c><span class="flag-normal">Normal</span></c>'],
              ['LEUCOCYTES', '<c><b class="num">11.4</b></c>', '10^3/µL', '4.0 – 10.0', '<c><span class="flag-high">Haute</span></c>'],
              ['PLAQUETTES', '<c><b class="num">245</b></c>', '10^3/µL', '150 – 400', '<c><span class="flag-normal">Normal</span></c>'],
            ],
          },
        },
      ],
      confidentialNote: 'Document médical confidentiel — loi 18-07 (Algérie)',
    };

    const html = renderDocHtml(spec);

    // Vérifie l'en-tête clinique
    expect(html).toContain('Laboratoire Central d’Analyses Médicales');
    expect(html).toContain('12 Rue Didouche Mourad, Alger');
    expect(html).toContain('021 00 00 00');

    // Vérifie les données patient
    expect(html).toContain('BENALI SAMIR');
    expect(html).toContain('PAT-00123');
    expect(html).toContain('38 ans');
    expect(html).toContain('88 1234 5678 90');
    expect(html).toContain('DR. BRAHIMI KARIM');

    // Vérifie les détails de l’acte
    expect(html).toContain('Détails &amp; données de l’examen');
    expect(html).toContain('EDTA (violet)');

    // Vérifie le tableau des résultats
    expect(html).toContain('<table class="grid">');
    expect(html).toContain('HÉMOGLOBINE');
    expect(html).toContain('13.8');
    expect(html).toContain('LEUCOCYTES');
    expect(html).toContain('11.4');
    expect(html).toContain('flag-high');
    expect(html).toContain('flag-normal');

    // Vérifie les styles de pagination pour l’impression
    expect(html).toContain('table.grid{width:100%;border-collapse:collapse;margin:8px 0 14px;page-break-inside:auto}');
    expect(html).toContain('table.grid thead{display:table-header-group}');
    expect(html).toContain('table.grid tr{page-break-inside:avoid;page-break-after:auto}');
    expect(html).toContain('@media print');
    expect(html).toContain('table.grid thead{display:table-header-group}');
  });
});
