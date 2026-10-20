/**
 * npm run db:sync — MISE À JOUR INCRÉMENTALE des données de référence dans une base EXISTANTE.
 * ------------------------------------------------------------------
 * Contrairement à `npm run seed` (jeu de démonstration complet), ce script ne touche AUCUNE
 * donnée existante : il n'efface, ne modifie et ne réordonne rien. Il fait uniquement :
 *   1. insérer les catégories d'intervention (préfixes LAB, CAR, ORD…) absentes — source unique
 *      `DEFAULT_CATEGORIES` du package partagé, donc alignée avec le code ;
 *   2. créer une « consultation générale » par catégorie qui n'a encore aucun type d'intervention
 *      (une catégorie sans type est inutilisable côté saisie) ;
 *   3. matérialiser en base les sections de réglages absentes avec leurs valeurs par défaut
 *      (général, ui, codification, référentiels médicaux, GED, types de praticiens, workflow,
 *      calendrier vaccinal national) — visibles et modifiables immédiatement dans Réglages, sans
 *      jamais écraser une section déjà enregistrée par l'administrateur ;
 *   4. AJOUTER aux rôles système les permissions des modules apparus depuis leur création (un
 *      module nouveau — ex. `vaccination` — n'existe pas dans les rôles d'une base installée avant
 *      lui : sans cette étape, personne d'autre que l'administrateur ne verrait l'écran). Les
 *      permissions accordées par l'administrateur ne sont JAMAIS retirées ;
 *   5. afficher un rapport (inséré / déjà présent).
 * À lancer après une montée de version qui ajoute de nouveaux codes ou réglages :
 *   npm run db:sync      (idempotent — deux exécutions = même état).
 */
/* eslint-disable no-console */

async function main(): Promise<void> {
  process.env.SARDPI_SCRIPT = '1';
  const { getDb } = await import('../apps/web/src/server/data');
  const { getSection, saveSection, SECTION_NAMES } = await import('../apps/web/src/server/settings');
  const { DEFAULT_CATEGORIES } = await import('@sardpi/shared');

  const db = await getDb();
  const NOW = new Date().toISOString();
  const ins = async (table: string, row: Record<string, unknown>): Promise<number> => (await db.insert(table, { created_at: NOW, updated_at: NOW, ...row })).id;
  const report: { step: string; detail: string; done: 'inséré' | 'déjà présent' | 'créé' | 'en place' }[] = [];

  /* 1. catégories (préfixes de code) manquantes */
  for (const c of DEFAULT_CATEGORIES) {
    const found = await db.findOne<{ id: number }>('intervention_categories', { prefix: c.prefix });
    if (found) {
      report.push({ step: `catégorie ${c.prefix}`, detail: String(c.label.fr ?? ''), done: 'déjà présent' });
      continue;
    }
    await ins('intervention_categories', { code: c.prefix, prefix: c.prefix, module: c.module, color: c.color, icon: c.icon, label_json: c.label, active: 1 });
    report.push({ step: `catégorie ${c.prefix}`, detail: String(c.label.fr ?? ''), done: 'inséré' });
  }

  /* 2. une consultation générale par catégorie sans aucun type */
  for (const c of DEFAULT_CATEGORIES) {
    const count = await db.count('intervention_types', { where: { category_prefix: c.prefix } });
    if (count > 0) continue;
    await ins('intervention_types', {
      code: `${c.prefix}_generale`,
      category_prefix: c.prefix,
      type_code: 'generale',
      name_json: { fr: `Consultation ${String(c.label.fr ?? c.prefix)}`, ar: `استشارة ${String(c.label.ar ?? '')}`, es: `Consulta ${String(c.label.es ?? c.prefix)}`, en: `${String(c.label.en ?? c.prefix)} consultation` },
      fields_json: [
        { key: 'motif', kind: 'textarea', label: { fr: 'Motif', ar: 'سبب الزيارة', es: 'Motivo', en: 'Reason' }, required: true },
        { key: 'conduite', kind: 'textarea', label: { fr: 'Conduite thérapeutique', ar: 'العلاج', es: 'Conducta', en: 'Plan' }, required: true },
      ],
      statuses_json: ['draft', 'validated', 'cancelled'],
      default_status: 'draft',
      views_json: { formColumns: 2, listColumns: [] },
      pdf_template: 'report',
      require_verify_token: 1,
      active: 1,
    });
    report.push({ step: `type ${c.prefix}_generale`, detail: 'consultation générale par défaut', done: 'créé' });
  }

  /* 3. sections de réglages absentes → valeurs par défaut matérialisées (jamais d'écrasement) */
  for (const name of SECTION_NAMES) {
    const stored = await db.findOne<{ id: number }>('settings', { key: name });
    if (stored) continue;
    const value = (await getSection(name)) as Record<string, unknown>;
    await saveSection(name, value);
    report.push({ step: `réglages ${name}`, detail: 'valeurs par défaut initialisées', done: 'créé' });
  }

  /* 4. rôles système : permissions des modules ajoutés depuis (union, jamais de retrait) */
  const { SEED_ROLES } = await import('@sardpi/shared');
  const { invalidateRoleCache } = await import('../apps/web/src/server/auth/guard');
  let rolesTouched = 0;
  for (const seed of SEED_ROLES) {
    const row = await db.findOne<{ id: number; perms_json: unknown }>('roles', { role_key: seed.key });
    if (!row) {
      // rôle supprimé volontairement par l'administrateur : on ne le recrée pas (db:sync n'insère que
      // des droits manquants, jamais des comptes/paramétrages retirés à dessein)
      report.push({ step: `rôle ${seed.key}`, detail: 'rôle absent (supprimé ?) — ignoré', done: 'en place' });
      continue;
    }
    const current = Array.isArray(row.perms_json)
      ? (row.perms_json as string[]).map(String)
      : typeof row.perms_json === 'string'
        ? (JSON.parse(row.perms_json) as string[]).map(String)
        : [];
    const missing = seed.perms.filter((p) => !current.includes(p));
    if (!missing.length) {
      report.push({ step: `rôle ${seed.key}`, detail: 'permissions à jour', done: 'en place' });
      continue;
    }
    await db.update('roles', Number(row.id), { perms_json: [...current, ...missing], updated_at: NOW });
    rolesTouched++;
    report.push({
      step: `rôle ${seed.key}`,
      detail: `+${missing.length} : ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}`,
      done: 'inséré',
    });
  }
  // les permissions sont mises en cache 60 s par rôle (tag « perms ») : purge inter-processus
  await invalidateRoleCache();
  if (rolesTouched) console.log(`[db:sync] ${rolesTouched} rôle(s) système complété(s) — nouveaux modules accessibles.`);

  /* rapport */
  const fresh = report.filter((r) => r.done !== 'déjà présent' && r.done !== 'en place');
  console.log(`[db:sync] ${report.length} élément(s) vérifié(s), ${fresh.length} nouveauté(s).`);
  if (fresh.length) console.table(fresh);
  console.log('[db:sync] ✓ terminée — aucune donnée existante supprimée ou réécrite (ajouts uniquement).');
  await db.close();
}

main().catch((e) => {
  console.error('[db:sync] échec :', e);
  process.exit(1);
});
