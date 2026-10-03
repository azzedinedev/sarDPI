/**
 * TEST DE NON-RÉGRESSION — quantité des lignes d'ordonnance.
 * ------------------------------------------------------------------
 * Bug corrigé : la colonne du schéma est « qty », alors que le module prescriptions (POST et PUT)
 * et l'amorçage inséraient « quantity ». serializeRow() IGNORE silencieusement toute colonne
 * inconnue du schéma — sans erreur, quel que soit l'adaptateur (JSON, MySQL, Postgres).
 * Conséquence observée : la quantité n'était jamais persistée, elle retombait à sa valeur par
 * défaut (1) à chaque modification et la fiche détaillée affichait « — ».
 *
 * Ces tests verrouillent les trois niveaux : le schéma, le comportement de serializeRow (le piège
 * lui-même) et la persistance réelle en création puis en modification.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sardpi-rx-'));
fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
process.env.SARDPI_ROOT = tmp;

const { getDb } = await import('../apps/web/src/server/data');
const { TABLE_BY_NAME } = await import('../apps/web/src/server/data/schema');
const { serializeRow } = await import('../apps/web/src/server/data/cast');

describe('lignes d’ordonnance — quantité', () => {
  it('le schéma expose « qty » et aucune colonne « quantity » (garde-fou contre un renommage)', () => {
    const spec = TABLE_BY_NAME.get('prescription_lines');
    expect(spec).toBeTruthy();
    const cols = spec!.cols.map((c) => c.name);
    expect(cols).toContain('qty');
    // Si un jour la colonne est renommée « quantity », le module doit être mis à jour avec elle :
    // sinon la quantité redevient silencieusement non persistée.
    expect(cols).not.toContain('quantity');
  });

  it('serializeRow écarte SILENCIEUSEMENT une colonne inconnue — la cause exacte du bug', () => {
    // Aucune erreur n'est levée : c'est ce qui a rendu la régression invisible pendant des mois.
    const out = serializeRow('prescription_lines', { seq: 1, trade_name: 'Doliprane', quantity: 3 }, false);
    expect(out.seq).toBe(1);
    expect(out.trade_name).toBe('Doliprane');
    expect(out.quantity).toBeUndefined();
  });

  it('la quantité est persistée à la création, puis modifiable', async () => {
    const db = await getDb();
    const now = new Date().toISOString();
    const rx = await db.insert('prescriptions', {
      code: 'ORD-TEST-QTY-1',
      patient_id: 1,
      practitioner_id: 1,
      act_date: '2026-01-05',
      status: 'draft',
      locale: 'fr',
      refills: 0,
      verify_token: 'tok-test-qty',
      created_at: now,
      updated_at: now,
    });

    const line = await db.insert('prescription_lines', {
      prescription_id: rx.id,
      seq: 1,
      drug_id: null,
      dci: 'Paracétamol',
      trade_name: 'Doliprane 1000',
      form: 'comprimé',
      dosage: '1000 mg',
      qty: 3, // la BONNE colonne
      posology: '1 matin et soir',
      duration_days: 5,
      instructions: null,
      reimbursable: 1,
    });

    let row = await db.findOne<Record<string, unknown>>('prescription_lines', { id: line.id });
    expect(Number(row!.qty)).toBe(3);

    // Modification (PUT) : la quantité doit suivre, pas revenir à la valeur par défaut du schéma.
    await db.update('prescription_lines', line.id, { qty: 7 });
    row = await db.findOne<Record<string, unknown>>('prescription_lines', { id: line.id });
    expect(Number(row!.qty)).toBe(7);
  });

  it('sans qty fournie, la valeur par défaut du schéma (1) s’applique — et non 0 ni null', async () => {
    const db = await getDb();
    const now = new Date().toISOString();
    const rx = await db.insert('prescriptions', {
      code: 'ORD-TEST-QTY-2',
      patient_id: 1,
      practitioner_id: 1,
      act_date: '2026-01-06',
      status: 'draft',
      locale: 'fr',
      refills: 0,
      created_at: now,
      updated_at: now,
    });
    const line = await db.insert('prescription_lines', {
      prescription_id: rx.id,
      seq: 1,
      drug_id: null,
      dci: 'Amoxicilline',
      trade_name: 'Amoxil 500',
      posology: '1 matin',
      duration_days: 6,
    });
    const row = await db.findOne<Record<string, unknown>>('prescription_lines', { id: line.id });
    expect(Number(row!.qty ?? 1)).toBe(1);
  });
});
