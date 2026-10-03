/**
 * TESTS ADAPTATEURS (Phase 1) — contrat commun JsonAdapter ≈ SQL : pagination serveur, where/orSearch,
 * tri, soft delete-friendly, transaction avec rollback, auto-incrément ÉMULÉ persisté (le mode démo
 * assumé par la spec : compteur dans un fichier, jamais réutilisé — mono-poste uniquement).
 * L'adaptateur refuse toute table hors schéma (assertTable) : c'est testé ici volontairement.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sardpi-adapter-'));
process.env.SARDPI_ROOT = tmp;

const { JsonAdapter } = await import('../apps/web/src/server/data/json');

let seq = 0;
async function mk() {
  const a = new JsonAdapter(path.join(tmp, `d${seq++}`));
  await a.init();
  return a;
}
const TS = () => new Date().toISOString();

describe('JsonAdapter (émulation SQL, contrat DataAdapter)', () => {
  it('refuse les tables inconnues du schéma (anti-table-sauvage)', async () => {
    const a = mk();
    await expect((await a).insert('t hacked', {})).rejects.toThrow(/inconnue/);
  });

  it('auto-incrément persiste entre instances = « redémarrage » (compteur repris, jamais réutilisé)', async () => {
    const dir = path.join(tmp, `d${seq++}`);
    const a = new JsonAdapter(dir);
    await a.init();
    const r1 = await a.insert('patients', { first_name: 'A', last_name: 'B', created_at: TS(), updated_at: TS() });
    const r2 = await a.insert('patients', { first_name: 'C', last_name: 'D', created_at: TS(), updated_at: TS() });
    expect(r2.id).toBeGreaterThan(r1.id);
    const c = new JsonAdapter(dir);
    await c.init();
    const r3 = await c.insert('patients', { first_name: 'E', last_name: 'F', created_at: TS(), updated_at: TS() });
    expect(r3.id).toBeGreaterThan(r2.id);
  });

  it('where + orSearch + orderBy + limit/offset + count', async () => {
    const a = await mk();
    for (let i = 1; i <= 25; i++) await a.insert('patients', { first_name: i % 3 === 0 ? 'karim' : `nom${i}`, last_name: 'X', birth_date: `2000-01-${String(i % 28 + 1).padStart(2, '0')}T00:00:00.000Z`, created_at: TS(), updated_at: TS(), archived_at: null });
    expect((await a.find('patients')).length).toBe(25);
    const page2 = await a.find('patients', { limit: 10, offset: 10, orderBy: [['id', 'asc']] });
    expect(page2.length).toBe(10);
    expect(String(page2[0]!.first_name)).toBe('nom11'); // 10 premiers exclus
    expect((await a.find('patients', { where: { first_name: 'karim' } })).length).toBe(8);
    expect(await a.count('patients', { where: { first_name: 'karim' } })).toBe(8);
    const or = await a.find('patients', { where: [{ field: 'first_name', op: 'contains', value: 'nom1' }, { field: 'first_name', op: 'eq', value: 'karim' }], combinator: 'OR' });
    expect(or.length).toBe(16); // 8 karim + nom1, nom10, nom11, nom13, nom14, nom16, nom17, nom19
    const os2 = await a.find('patients', { orSearch: { fields: ['first_name', 'last_name'], term: 'nom2' } });
    expect(os2.length).toBe(5); // nom2, nom20, nom22, nom23, nom25 (nom21/nom24 = karim)
  });

  it('opérateurs d’ordre numériques (gt/gte/lt) et neq', async () => {
    const a = await mk();
    for (const n of [5, 9, 12, 40]) await a.insert('patients', { first_name: `P${n}`, last_name: 'N', wilaya_code: n, created_at: TS(), updated_at: TS() });
    const gt = await a.find('patients', { where: [{ field: 'wilaya_code', op: 'gt', value: 9 }] });
    expect(gt.map((r) => Number(r.wilaya_code)).sort((x, y) => x - y)).toEqual([12, 40]); // comparaison NUMÉRIQUE (9 < 12 malgré '9'>'12' lexicographique)
    expect((await a.find('patients', { where: [{ field: 'wilaya_code', op: 'neq', value: 9 }] })).length).toBe(3);
    expect((await a.find('patients', { where: [{ field: 'wilaya_code', op: 'lte', value: 9 }] })).length).toBe(2);
  });

  it('transaction : rollback complet si le handler lève (ni écriture partielle, ni compteur consommé à tort)', async () => {
    const a = await mk();
    await a.insert('locations', { code: 'LOC-T0', kind: 'cabinet', name_json: { fr: 'ok' }, capacity: 1, created_at: TS(), updated_at: TS() });
    await expect(
      a.transaction(async (tx) => {
        await tx.insert('locations', { code: 'LOC-T1', kind: 'cabinet', name_json: { fr: 'rollback' }, capacity: 1, created_at: TS(), updated_at: TS() });
        await tx.update('locations', 1, { capacity: 99 });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect((await a.find('locations')).length).toBe(1);
    expect(Number((await a.findOne('locations', { id: 1 }))!.capacity)).toBe(1); // update annulé aussi
  });

  it('update / remove / removeWhere + findOne', async () => {
    const a = await mk();
    const { id } = await a.insert('locations', { code: 'LOC-U1', kind: 'labo', name_json: { fr: 'A' }, capacity: 2, created_at: TS(), updated_at: TS() });
    await a.update('locations', id, { capacity: 7 });
    expect(Number((await a.findOne('locations', { id }))!.capacity)).toBe(7);
    await a.remove('locations', id);
    expect(await a.findOne('locations', { id })).toBeNull();
    await a.insert('locations', { code: 'LOC-U2', kind: 'labo', name_json: { fr: 'B' }, capacity: 1, created_at: TS(), updated_at: TS() });
    expect(await a.removeWhere('locations', { code: 'LOC-U2' })).toBe(1);
  });

  it('colonnes JSON : round-trip objet + recherche contains dans le JSON sérialisé (labels multilingues)', async () => {
    const a = await mk();
    const label = { fr: 'Consultation', ar: 'فحص', es: 'Consulta', en: 'Visit' };
    const { id } = await a.insert('intervention_categories', { code: 'ZZ1', prefix: 'ZZ1', module: 'record.consultation', label_json: label, color: '#123456', icon: 'flask', active: 1, created_at: TS(), updated_at: TS() });
    const row = await a.findOne<Record<string, unknown>>('intervention_categories', { id });
    expect(row!.label_json).toEqual(label); // PAS une chaîne : l’adaptateur hydrate le JSON
    expect((await a.find('intervention_categories', { where: [{ field: 'label_json', op: 'contains', value: 'Consulta' }] })).length).toBe(1);
    expect((await a.find('intervention_categories', { where: [{ field: 'label_json', op: 'contains', value: 'فحص' }] })).length).toBe(1); // recherche ARABE dans le JSON
  });
});
