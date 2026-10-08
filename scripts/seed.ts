/**
 * npm run seed — jeu de démonstration ALGÉRIEN complet (4 langues : fr/ar/es/en).
 * ------------------------------------------------------------------
 * ⚠ Ce script N'ÉCRIT JAMAIS de données dans un environnement de production : il refuse de tourner
 *   si la table `users` contient déjà des comptes, sauf `--force` (réservé JSON/memory — démo).
 *   Les codes métier sont générés par le VRAI service de codification (transactions + verrou
 *   SELECT…FOR UPDATE) : PAT-00001, MED-00001, LOC-001, RDV-…, codes combinés de fiches et
 *   d'ordonnances — exactement ce que produit l'application.
 * Champs sensibles (tél./e-mail/NIN/Chifa) : passés EN CLAIR ici — l'adaptateur de données les
 * chiffre lui-même en AES-256-GCM (colonnes `enc`), comme en production.
 *
 * Lancement : npm run seed   (= vite-node scripts/seed.ts)   — voir README §Démarrage + VS Code.
 */
/* eslint-disable no-console */

const FORCE = process.argv.includes('--force');
const NOW = new Date().toISOString();
const DAY = (offset: number, hh = 9, mm = 0): string => {
  const d = new Date(Date.UTC(2026, 8, 30 + offset, hh, mm)); // base : 30 sept. 2026
  return d.toISOString();
};

async function main(): Promise<void> {
  process.env.SARDPI_SCRIPT = '1';
  const { getDb, effectiveConfig } = await import('../apps/web/src/server/data');
  const { hashPassword } = await import('../apps/web/src/server/auth/password');
  const { SEED_ROLES } = await import('@sardpi/shared');
  const { allocatePatientCode, allocateRecordCode, allocateSuffixed } = await import('../apps/web/src/server/codes/service');

  const cfg = effectiveConfig();
  console.log(`[seed] adaptateur : ${cfg.adapter}${cfg.adapter === 'json' || cfg.adapter === 'memory' ? ' (mode démo — compteurs auto-incrémentés persistés dans data/)' : ''}`);

  if (FORCE && (cfg.adapter === 'json' || cfg.adapter === 'memory')) {
    // --force en démo uniquement : repartir de zéro en supprimant les fichiers de tables AVANT d'ouvrir l'adaptateur.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { paths } = await import('../apps/web/src/server/config');
    if (fs.existsSync(paths.data)) for (const f of fs.readdirSync(paths.data)) if (f.endsWith('.json') && f !== 'config.json') fs.rmSync(path.join(paths.data, f));
    console.log('[seed] --force : données démo effacées, création…');
  }
  const db = await getDb();

  const users0 = await db.count('users');
  if (users0 > 0 && !FORCE) {
    const p0 = await db.count('patients');
    console.log(`[seed] base non vide (${users0} utilisateurs, ${p0} patients) — ABANDON. Utilise « npm run seed -- --force » en environnement de DÉMO uniquement.`);
    await db.close();
    return;
  }

  const ins = async (table: string, row: Record<string, unknown>): Promise<number> => (await db.insert(table, { created_at: NOW, updated_at: NOW, ...row })).id;

  /* ------------------------------------------------------------- 1. rôles & comptes */
  const roleIds = new Map<string, number>();
  for (const r of SEED_ROLES) {
    const found = await db.findOne<{ id: number }>('roles', { role_key: r.key });
    roleIds.set(r.key, found ? found.id : await ins('roles', { role_key: r.key, name_json: r.name, perms_json: r.perms, system: 1 }));
  }
  const adminPw = process.env.SARDPI_ADMIN_PASSWORD || 'Admin!2026-dz';
  const userIds: Record<string, number> = {};
  const mkUser = async (u: { username: string; email: string; full: string; pw: string; role: string; locale?: string }): Promise<number> => {
    if ((await db.findOne('users', { username: u.username }))) return Number((await db.findOne<{ id: number }>('users', { username: u.username }))!.id);
    return ins('users', {
      username: u.username, email: u.email, full_name: u.full, password_hash: await hashPassword(u.pw),
      role_id: roleIds.get(u.role), locale: u.locale ?? 'fr', active: 1, must_change_password: 0, failed_attempts: 0,
    });
  };
  userIds.admin = await mkUser({ username: 'admin', email: 'admin@cabinet.dz', full: 'Amina BENKHELFOUN', pw: adminPw, role: 'admin' });
  userIds.doc = await mkUser({ username: 'dr.merabet', email: 'y.merabet@cabinet.dz', full: 'Yacine MERABET', pw: 'Medecin!2026-dz', role: 'physician', locale: 'ar' });
  userIds.lab = await mkUser({ username: 'labo', email: 'labo@cabinet.dz', full: 'Nadia SAADI', pw: 'Labo!2026-dz', role: 'labtech' });
  userIds.sec = await mkUser({ username: 'accueil', email: 'accueil@cabinet.dz', full: 'Soraya BELKACEMI', pw: 'Accueil!2026-dz', role: 'secretary' });

  /* ------------------------------------------------------------- 2. wilayas (58) */
  const W: [string, string, string][] = [
    ['01', 'Adrar', 'أدرار'], ['02', 'Chlef', 'الشلف'], ['03', 'Laghouat', 'الأغواط'], ['04', 'Oum El Bouaghi', 'أم البواقي'],
    ['05', 'Batna', 'باتنة'], ['06', 'Béjaïa', 'بجاية'], ['07', 'Biskra', 'بسكرة'], ['08', 'Béchar', 'بشار'],
    ['09', 'Blida', 'البليدة'], ['10', 'Bouira', 'البويرة'], ['11', 'Tamanrasset', 'تمنراست'], ['12', 'Tébessa', 'تبسة'],
    ['13', 'Tlemcen', 'تلمسان'], ['14', 'Tiaret', 'تيارت'], ['15', 'Tizi Ouzou', 'تيزي وزو'], ['16', 'Alger', 'الجزائر'],
    ['17', 'Djelfa', 'الجلفة'], ['18', 'Jijel', 'جيجل'], ['19', 'Sétif', 'سطيف'], ['20', "Saïda", 'سعيدة'],
    ['21', 'Skikda', 'سكيكدة'], ['22', "Sidi Bel Abbès", 'سيدي بلعباس'], ['23', 'Annaba', 'عنابة'], ['24', 'Guelma', 'قالمة'],
    ['25', 'Constantine', 'قسنطينة'], ['26', 'Médéa', 'المدية'], ['27', 'Mostaganem', 'مستغانم'], ['28', "M'Sila", 'المسيلة'],
    ['29', 'Mascara', 'معسكر'], ['30', 'Ouargla', 'ورقلة'], ['31', 'Oran', 'وهران'], ['32', 'El Bayadh', 'البيض'],
    ['33', 'Illizi', 'إليزي'], ['34', 'Bordj Bou Arréridj', 'برج بوعريريج'], ['35', 'Boumerdès', 'بومرداس'], ['36', 'El Tarf', 'الطارف'],
    ['37', 'Tindouf', 'تندوف'], ['38', 'Tissemsilt', 'تيسمسيلت'], ['39', 'El Oued', 'الوادي'], ['40', 'Khenchela', 'خنشلة'],
    ['41', 'Souk Ahras', 'سوق أهراس'], ['42', 'Tipaza', 'تيبازة'], ['43', 'Mila', 'ميلة'], ['44', 'Aïn Defla', 'عين الدفلى'],
    ['45', 'Naâma', 'النعامة'], ['46', 'Aïn Témouchent', 'عين تموشنت'], ['47', 'Ghardaïa', 'غرداية'], ['48', 'Relizane', 'غليزان'],
    ['49', 'Timimoun', 'تيميمون'], ['50', 'Bordj Badji Mokhtar', 'برج باجي مختار'], ['51', 'Ouled Djellal', 'أولاد جلال'],
    ['52', 'Béni Abbès', 'بني عباس'], ['53', 'In Salah', 'عين صالح'], ['54', 'In Guezzam', 'عين قزام'], ['55', 'Touggourt', 'تقرت'],
    ['56', 'Djanet', 'جانت'], ['57', "El M'Ghair", 'المغير'], ['58', 'El Meniaa', 'المنيعة'],
  ];
  if (!(await db.count('admin_regions'))) {
    for (const [code, fr, ar] of W) await ins('admin_regions', { kind: 'wilaya', code_str: code, name_fr: fr, name_ar: ar, active: 1 });
    console.log(`[seed] ${W.length} wilayas`);
  }

  /* ------------------------------------------------------------- 3. lieux */
  const locIds: number[] = [];
  for (const l of [
    { kind: 'cabinet', name: { fr: 'Cabinet — Consultation 1', ar: 'عيادة — كشف 1', es: 'Consulta 1', en: 'Consultation room 1' }, building: 'Bloc A', capacity: 1, hours: { '0': [['08:00', '16:00']], '1': [['08:00', '16:00']], '2': [['08:00', '16:00']], '3': [['08:00', '16:00']], '4': [['08:00', '16:00']], '6': [['08:00', '12:00']] } },
    { kind: 'labo', name: { fr: 'Laboratoire d’analyses', ar: 'مخبر التحاليل', es: 'Laboratorio', en: 'Laboratory' }, building: 'Bloc B', capacity: 3, hours: { '0': [['07:30', '15:30']], '1': [['07:30', '15:30']], '2': [['07:30', '15:30']], '3': [['07:30', '15:30']], '4': [['07:30', '15:30']] } },
    { kind: 'imagerie', name: { fr: 'Salle d’imagerie / échographie', ar: 'قاعة التصوير', es: 'Sala de imagen', en: 'Imaging room' }, building: 'Bloc B', capacity: 1, hours: { '0': [['09:00', '17:00']], '2': [['09:00', '17:00']], '4': [['09:00', '17:00']] } },
  ]) {
    const { code } = await allocateSuffixed('location', 'LOC');
    locIds.push(await ins('locations', { code, kind: l.kind, name_json: l.name, capacity: l.capacity, building: l.building, address: 'Ctt. Ali-Mali, Boumerdès 35000', wilaya_code: 35, open_hours_json: l.hours, active: 1 }));
  }

  /* ------------------------------------------------------------- 4. catégories (14) & types config */
  const CATS: { p: string; module: string; fr: string; ar: string; es: string; en: string; color: string; icon: string }[] = [
    { p: 'LAB', module: 'record.lab', fr: 'Analyses médicales', ar: 'التحاليل الطبية', es: 'Análisis', en: 'Laboratory', color: '#0ea5b7', icon: 'flask' },
    { p: 'PHA', module: 'record.pharmacy', fr: 'Pharmacie / délivrance', ar: 'الصيدلية', es: 'Farmacia', en: 'Pharmacy', color: '#22c55e', icon: 'pill' },
    { p: 'DIA', module: 'record.diagnosis', fr: 'Diagnostic', ar: 'التشخيص', es: 'Diagnóstico', en: 'Diagnosis', color: '#8b5cf6', icon: 'search' },
    { p: 'CAR', module: 'record.cardio', fr: 'Cardiologie', ar: 'أمراض القلب', es: 'Cardiología', en: 'Cardiology', color: '#ef4444', icon: 'heart' },
    { p: 'RAD', module: 'record.radio', fr: 'Radiologie / imagerie', ar: 'الأشعة', es: 'Radiología', en: 'Radiology', color: '#f59e0b', icon: 'scan' },
    { p: 'CON', module: 'record.consultation', fr: 'Consultations', ar: 'الفحوصات', es: 'Consultas', en: 'Consultations', color: '#3b82f6', icon: 'stethoscope' },
    { p: 'SPE', module: 'record.specialties', fr: 'Autres spécialités', ar: 'تخصصات أخرى', es: 'Otras especialidades', en: 'Other specialties', color: '#14b8a6', icon: 'microscope' },
    { p: 'GYP', module: 'record.gynped', fr: 'Gynécologie / pédiatrie', ar: 'النسائية والطب الشرعي', es: 'Ginecología/pediatría', en: 'Gyneco/pediatrics', color: '#ec4899', icon: 'baby' },
    { p: 'CHI', module: 'record.surgery', fr: 'Chirurgie', ar: 'الجراحة', es: 'Cirugía', en: 'Surgery', color: '#64748b', icon: 'scalpel' },
    { p: 'SOI', module: 'record.care', fr: 'Soins infirmiers', ar: 'العلاجات التمريضية', es: 'Cuidados', en: 'Nursing care', color: '#06b6d4', icon: 'syringe' },
    { p: 'ANA', module: 'record.anatpath', fr: 'Anatomie pathologique', ar: 'علم الأمراض التشريحي', es: 'Anatomía patológica', en: 'Pathology', color: '#a855f7', icon: 'microscope' },
    { p: 'REE', module: 'record.reeducation', fr: 'Rééducation', ar: 'إعادة التأهيل', es: 'Rehabilitación', en: 'Rehabilitation', color: '#84cc16', icon: 'activity' },
    { p: 'CER', module: 'record.certificates', fr: 'Certificats & demandes', ar: 'الشهادات والطلبات', es: 'Certificados', en: 'Certificates', color: '#eab308', icon: 'file' },
    { p: 'ORD', module: 'record.consultation', fr: 'Ordonnances (fiches)', ar: 'الوصفات الطبية', es: 'Recetas', en: 'Prescriptions (records)', color: '#22d3ee', icon: 'pill' },
  ];
  const catByPrefix = new Map<string, number>();
  for (const c of CATS) {
    const found = await db.findOne<{ id: number }>('intervention_categories', { prefix: c.p });
    catByPrefix.set(c.p, found ? found.id : await ins('intervention_categories', { code: c.p, prefix: c.p, module: c.module, color: c.color, icon: c.icon, label_json: { fr: c.fr, ar: c.ar, es: c.es, en: c.en }, active: 1 }));
  }

  const ml = (fr: string, ar: string, es = fr, en = fr): Record<string, string> => ({ fr, ar, es, en });
  const TYPES: Record<string, unknown>[] = [
    { category_prefix: 'CON', type_code: 'generale', name: ml('Consultation générale', 'فحص عام', 'Consulta general', 'General consultation'), fields: [{ key: 'motif', kind: 'textarea', label: ml('Motif', 'سبب الزيارة', 'Motivo', 'Reason'), required: true }, { key: 'ta_sys', kind: 'number', label: ml('TA systolique', 'الضغط الانبساطي', 'TA sistólica', 'Systolic BP'), unit: 'mmHg' }, { key: 'ta_dia', kind: 'number', label: ml('TA diastolique', 'الضغط', 'TA diastólica', 'Diastolic BP'), unit: 'mmHg' }, { key: 'poids', kind: 'number', label: ml('Poids', 'الوزن', 'Peso', 'Weight'), unit: 'kg' }, { key: 'taille', kind: 'number', label: ml('Taille', 'الطول', 'Altura', 'Height'), unit: 'cm' }, { key: 'conduite', kind: 'textarea', label: ml('Conduite thérapeutique', 'العلاج', 'Conducta', 'Plan'), required: true }], pdf: 'report' },
    { category_prefix: 'CAR', type_code: 'ecg', name: ml('Électrocardiogramme', 'تخطيط القلب', 'Electrocardiograma', 'Electrocardiogram'), fields: [{ key: 'fc', kind: 'number', label: ml('Fréq. cardiaque', 'معدل النبض', 'FC', 'Heart rate'), unit: 'bpm' }, { key: 'rythme', kind: 'select', label: ml('Rythme', 'النظم', 'Ritmo', 'Rhythm'), options: ['sinusal', 'fibrillation', 'autre'] }, { key: 'pr', kind: 'number', label: ml('PR (ms)', 'PR', 'PR', 'PR') }, { key: 'segments', kind: 'textarea', label: ml('Segments ST', 'قطعة ST', 'Segmento ST', 'ST segments') }, { key: 'conclusion', kind: 'textarea', label: ml('Conclusion', 'الخلاصة', 'Conclusión', 'Conclusion'), required: true }], pdf: 'report' },
    { category_prefix: 'CAR', type_code: 'echo', name: ml('Échocardiographie', 'صدى القلب', 'Ecocardiografía', 'Echocardiography'), fields: [{ key: 'fevg', kind: 'number', label: ml('FEVG (%)', 'الكسر القذالي', 'FEVI', 'LVEF'), unit: '%' }, { key: 'resume', kind: 'textarea', label: ml('Résultat', 'النتيجة', 'Resultado', 'Findings') }], pdf: 'report' },
    { category_prefix: 'RAD', type_code: 'rx_thorax', name: ml('Radiographie thoracique', 'أشعة الصدر', 'Radiografía de tórax', 'Chest X-ray'), fields: [{ key: 'indication', kind: 'text', label: ml('Indication', 'البيان', 'Indicación', 'Indication') }, { key: 'resultat', kind: 'textarea', label: ml('Résultat', 'النتيجة', 'Resultado', 'Findings'), required: true }], pdf: 'report' },
    { category_prefix: 'GYP', type_code: 'echo_obst', name: ml('Échographie obstétricale', 'صدى الحمل', 'Ecografía obstétrica', 'Obstetric ultrasound'), fields: [{ key: 'sa', kind: 'number', label: ml('SA', 'أسابيع الحمل', 'SG', 'GA'), unit: 'sa' }, { key: 'rcf', kind: 'number', label: ml('RCF', 'نبض الجنين', 'RCF', 'FHR'), unit: 'bpm' }, { key: 'conclusion', kind: 'textarea', label: ml('Conclusion', 'الخلاصة', 'Conclusión', 'Conclusion') }], pdf: 'report' },
    { category_prefix: 'SOI', type_code: 'pansement', name: ml('Pansement / soin', 'ضماد/علاج', 'Curación', 'Wound care'), fields: [{ key: 'site', kind: 'text', label: ml('Site', 'الموضع', 'Zona', 'Site') }, { key: 'geste', kind: 'textarea', label: ml('Geste réalisé', 'الإجراء', 'Procedimiento', 'Procedure'), required: true }], pdf: 'report' },
    { category_prefix: 'CER', type_code: 'cert_medical', name: ml('Certificat médical', 'شهادة طبية', 'Certificado médico', 'Medical certificate'), fields: [{ key: 'constat', kind: 'textarea', label: ml('Constat', 'المعاينة', 'Hallazgos', 'Findings'), required: true }, { key: 'periode', kind: 'text', label: ml('Période d’arrêt', 'مدة التوقف', 'Periodo', 'Leave period') }], pdf: 'certificate' },
    { category_prefix: 'ANA', type_code: 'anapath', name: ml('Examen anatomo-pathologique', 'دراسة نسيجية', 'Estudio anatomopatológico', 'Pathology exam'), fields: [{ key: 'prelevement', kind: 'text', label: ml('Prélèvement', 'العيّنة', 'Muestra', 'Specimen') }, { key: 'diagnostic', kind: 'textarea', label: ml('Diagnostic', 'التشخيص', 'Diagnóstico', 'Diagnosis'), required: true }], pdf: 'report' },
    { category_prefix: 'LAB', type_code: 'bio', name: ml('Bilan biologique courant', 'الكيمياء الحيوية العامة', 'Bioquímica clínica', 'Routine biochemistry'), fields: [{ key: 'prelevement_at', kind: 'datetime', label: ml('Date & heure de prélèvement', 'تاريخ ووقت أخذ العينة', 'Fecha y hora de toma', 'Sampling date & time'), required: true }, { key: 'sample_type', kind: 'select', label: ml('Nature de l’échantillon', 'نوع العيّنة', 'Tipo de muestra', 'Specimen type'), options: ['Sang veineux', 'Sang artériel', 'Urines', 'Autre'] }, { key: 'indication', kind: 'text', label: ml('Indication clinique', 'دواعي الفحص', 'Indicación clínica', 'Clinical indication') }, { key: 'conclusion', kind: 'textarea', label: ml('Interprétation / Conclusion', 'الخلاصة والتفسير', 'Interpretación', 'Interpretation'), required: true }], pdf: 'report' },
    { category_prefix: 'LAB', type_code: 'nfs', name: ml('Hémogramme complet (NFS)', 'تحليل الدم الشامل (NFS)', 'Hemograma completo', 'Complete blood count (CBC)'), fields: [{ key: 'prelevement_at', kind: 'datetime', label: ml('Date & heure de prélèvement', 'تاريخ ووقت أخذ العينة', 'Fecha y hora de toma', 'Sampling date & time'), required: true }, { key: 'tube', kind: 'select', label: ml('Tube de prélèvement', 'أنبوب العينة', 'Tubo de muestra', 'Tube type'), options: ['EDTA (violet)', 'Citrate (bleu)', 'Héparine (vert)', 'Sec (rouge)'] }, { key: 'indication', kind: 'text', label: ml('Indication clinique', 'دواعي الفحص', 'Indicación clínica', 'Clinical indication') }, { key: 'conclusion', kind: 'textarea', label: ml('Interprétation / Conclusion', 'الخلاصة والتفسير', 'Interpretación', 'Interpretation'), required: true }], pdf: 'report' },
    { category_prefix: 'LAB', type_code: 'urines', name: ml('Examen cytobactériologique des urines (ECBU)', 'تحليل البول والمزرعة الجرثومية', 'Urocultivo y sedimento', 'Urinalysis & culture'), fields: [{ key: 'mode_recueil', kind: 'select', label: ml('Mode de recueil', 'طريقة الجمع', 'Modo de recolección', 'Collection method'), options: ['Milieu de jet', 'Sondage vésical', 'Poche pédiatrique'] }, { key: 'aspect', kind: 'text', label: ml('Aspect macroscopique', 'المظهر العياني', 'Aspecto macroscópico', 'Macroscopic appearance') }, { key: 'conclusion', kind: 'textarea', label: ml('Conclusion', 'الخلاصة', 'Conclusión', 'Conclusion'), required: true }], pdf: 'report' },
    { category_prefix: 'LAB', type_code: 'serologie', name: ml('Sérologie & Immunologie', 'علم الأمصال والمناعة', 'Serología e inmunología', 'Serology & immunology'), fields: [{ key: 'technique', kind: 'text', label: ml('Technique / Automate', 'التقنية المستخدمة', 'Técnica', 'Method / Device') }, { key: 'indication', kind: 'text', label: ml('Indication', 'دواعي الفحص', 'Indicación', 'Indication') }, { key: 'conclusion', kind: 'textarea', label: ml('Résultats & Conclusion', 'النتائج والخلاصة', 'Resultados y conclusión', 'Results & conclusion'), required: true }], pdf: 'report' },
    { category_prefix: 'LAB', type_code: 'coag', name: ml('Hémostase & Coagulation (TP / INR / TCA)', 'تخثر الدم والسيولة', 'Coagulación y hemostasia', 'Hemostasis & coagulation'), fields: [{ key: 'traitement', kind: 'text', label: ml('Traitement anticoagulant', 'العلاج بمضادات التخثر', 'Tratamiento anticoagulante', 'Anticoagulant therapy') }, { key: 'conclusion', kind: 'textarea', label: ml('Interprétation', 'التفسير', 'Interpretación', 'Interpretation'), required: true }], pdf: 'report' },
  ];
  for (const t of TYPES) {
    const cp = String(t.category_prefix);
    const dup = await db.findOne('intervention_types', { category_prefix: cp, type_code: String(t.type_code) });
    if (dup) continue;
    await ins('intervention_types', {
      code: `${cp}_${t.type_code}`, category_prefix: cp, type_code: t.type_code, name_json: t.name,
      fields_json: t.fields, statuses_json: ['draft', 'validated', 'cancelled'], default_status: 'draft',
      views_json: { formColumns: 2, listColumns: [] }, pdf_template: t.pdf, require_verify_token: 1, active: 1,
    });
  }
  const typeIds = new Map<string, number>();
  for (const r of await db.find<{ id: number; code: string }>('intervention_types')) typeIds.set(r.code, r.id);

  /* ------------------------------------------------------------- 5. labo : panneaux & référentiel */
  const panels = [
    { code: 'NFS', name: ml('Numération formule sanguine', 'تحليل الدم الشامل', 'Hemograma', 'CBC'), specimen: 'sang veineux (EDTA)', params: [
      ['hgb', 'Hémoglobine', 'g/dL', 12, 16, 7, 20, null, null, null],
      ['leuk', 'Leucocytes', 'G/L', 4, 10, 1.5, 30, null, null, null],
      ['plt', 'Plaquettes', 'G/L', 150, 400, 30, 900, null, null, null],
      ['vgm', 'VGM', 'fL', 80, 100, null, null, null, null, null],
      ['hct', 'Hématocrite', '%', 36, 46, null, null, null, null, null],
    ] },
    { code: 'BIO', name: ml('Biochimie courante', 'الكيمياء الحيوية', 'Bioquímica', 'Basic biochem'), specimen: 'sanguin / urinaire', params: [
      ['gly', 'Glycémie à jeun', 'g/L', 0.7, 1.1, null, 2.5, null, null, null],
      ['crea', 'Créatinine', 'mg/L', 6, 14, null, null, null, null, null],
      ['crp', 'CRP', 'mg/L', 0, 5, null, 100, null, null, null],
      ['hba1c', 'HbA1c', '%', 4, 6.5, null, null, null, null, null],
      ['tsh', 'TSH', 'µUI/mL', 0.27, 4.2, null, null, null, null, null],
    ] },
  ];
  const paramBy = new Map<string, { id: number; key: string; unit: string; min: number | null; max: number | null; lo: number | null; hi: number | null }>();
  for (const p of panels) {
    const panelId = await ins('lab_panels', { code: p.code, name_json: p.name, specimen: p.specimen, active: 1 });
    let sort = 0;
    for (const [key, name, unit, min, max, clo, chi] of p.params) {
      const id = await ins('lab_parameters', { panel_id: panelId, param_key: key, name_json: typeof name === 'string' ? ml(name, name) : name, unit, ref_min: min, ref_max: max, crit_low: clo, crit_high: chi, sort: sort++ });
      paramBy.set(`${p.code}.${key}`, { id, key, unit, min, max, lo: clo, hi: chi } as never);
    }
  }

  /* ------------------------------------------------------------- 6. médicaments + stock */
  const DRUGS: [string, string, string, string, number, number, string][] = [
    ['Paracétamol', 'Doliprane 1000', 'comprimé', '1000 mg', 3.5, 80, 'N02BE01'],
    ['Amoxicilline', 'Clamoxyl 1 g', 'comprimé', '1 g', 6.2, 100, 'J01CA04'],
    ['Métronidazole', 'Flagyl 250 mg', 'comprimé', '250 mg', 4.1, 100, 'P01AB01'],
    ['Ibuprofène', 'Brufen 400', 'comprimé', '400 mg', 3.9, 60, 'M01AE01'],
    ['Lévothyroxine', 'Levothyrox 100 µg', 'comprimé', '100 µg', 5.5, 30, 'H03AA04'],
    ['Métformine', 'Gentut 850', 'comprimé', '850 mg', 4.8, 100, 'A10BA02'],
    ['Amlodipine', 'Amlor 5 mg', 'comprimé', '5 mg', 7.4, 100, 'C08CA01'],
    ['Salbutamol', 'Ventoline 100 µg', 'inhalateur', '100 µg/dose', 22.0, 200, 'R03AC02'],
    ['Oméprazole', 'Mopral 20 mg', 'gélule', '20 mg', 9.6, 28, 'A02BC01'],
    ['Céftriaxone', 'Rocephin 1 g', 'IV/IM flacon', '1 g', 14.5, 50, 'J01DD04'],
  ];
  const drugIds = new Map<string, number>();
  for (const [dci, trade, form, dosage, price, refund, atc] of DRUGS) {
    if (await db.findOne('drugs', { trade_name: trade })) {
      drugIds.set(dci, Number((await db.findOne<{ id: number }>('drugs', { trade_name: trade }))!.id));
      continue;
    }
    const { code } = await allocateSuffixed('drug', 'DRG');
    drugIds.set(dci, await ins('drugs', { code, dci, trade_name: trade, form, dosage, pack: `${trade} — boîte`, atc, reimbursable: 1, refund_rate: refund, price_dzd: price, labo: 'Saidal', active: 1 }));
  }
  const STOCK: [string, string, number, string][] = [
    ['Paracétamol', 'LOT-24A118', 240, '2027-04-30'],
    ['Amoxicilline', 'LOT-24B007', 96, '2026-11-10'], // proche péremption → badge « expiring »
    ['Métronidazole', 'LOT-25C012', 150, '2028-01-31'],
    ['Ibuprofène', 'LOT-24D220', 8, '2027-08-15'], // stock bas (mini 10 dans la config)
    ['Lévothyroxine', 'LOT-25E001', 0, '2027-02-28'], // rupture → badge
    ['Métformine', 'LOT-24F031', 120, '2027-06-30'],
    ['Amlodipine', 'LOT-24G110', 75, '2027-10-31'],
    ['Salbutamol', 'LOT-25H004', 40, '2027-12-31'],
    ['Oméprazole', 'LOT-24J019', 110, '2028-03-31'],
    ['Céftriaxone', 'LOT-24K002', 25, '2026-10-20'],
  ];
  for (const [dci, batch, qty, expiry] of STOCK) {
    const did = drugIds.get(dci)!;
    await ins('stock_items', { drug_id: did, batch, qty, expiry: `${expiry}T00:00:00.000Z`, location_id: locIds[1] });
    await ins('stock_moves', { drug_id: did, delta: qty, reason: 'réception initiale (seed)', at: DAY(-40), by_user: userIds.admin });
  }

  /* ------------------------------------------------------------- 7. praticiens */
  const PR: [string, string, string, string, string, string, string][] = [
    ['MED', 'Yacine', 'MERABET', 'ياسين', 'مرابط', 'cardiologie', '12/15-4567'],
    ['MED', 'Amine', 'BOUZID', 'أمين', 'بوزيد', 'médecine générale', '08/31-2210'],
    ['RDG', 'Karim', 'HADJADJ', 'كريم', 'حجاج', 'radiodiagnostic', '10/16-778'],
    ['PHR', 'Lila', 'MEZIANE', 'ليلى', 'مزياني', 'pharmacie d’officine', '05/35-11234'],
    ['INF', 'Samira', 'AOUI', 'سميرة', 'عاوي', 'soins généraux', '—'],
  ];
  const pracIds: number[] = [];
  for (const [pfx, fn, ln, fnA, lnA, sp, order] of PR) {
    const { code } = await allocateSuffixed('practitioner', pfx);
    pracIds.push(await ins('practitioners', { code, type_prefix: pfx, first_name: fn, last_name: ln, first_name_ar: fnA, last_name_ar: lnA, email: `${fn.toLowerCase()}.${ln.toLowerCase()}@cabinet.dz`, phone: '+213 550 12 34 56', order_number: order, speciality_json: ml(sp, sp), active: 1 }));
  }

  /* ------------------------------------------------------------- 8. patients */
  const PATS: Record<string, unknown>[] = [
    { first: 'Mohamed Amine', last: 'BOUDJEMAA', fr_ar: ['محمد الأمين', 'بو جمعة'], birth: '1985-03-12', sex: 'M', w: 35, daira: 'Boudouaoua', commune: 'Naciria', addr: 'Cité 400 lggt, Naciria', phone: '+213 661 45 78 12', email: 'ma.boudjemaa@gmail.com', nin: '000585031235004578', ss: 'CNAS', ssN: '3512345678', chifa: '0001234567890', allergies: ['pénicilline'], blood: 'O+', locale: 'fr', antecedents: ['HTA sous amlodipine'] },
    { first: 'Fatima', last: 'ZITOUNI', fr_ar: ['فاطمة', 'زيتوني'], birth: '1992-07-25', sex: 'F', w: 16, daira: 'Bab Ezzouar', commune: 'Dar El Beïda', addr: '12 rue des Frères Bouadou', phone: '+213 770 22 41 09', email: 'fatima.z@outlook.dz', nin: '100292072516007702', ss: 'CNAS', ssN: '1609876543', chifa: '0009876543210', allergies: [], blood: 'A+', locale: 'ar', antecedents: ['Grossesse G2 — 28 SA'] },
    { first: 'Karim', last: 'SLIMANI', fr_ar: ['كريم', 'سليماني'], birth: '1968-11-02', sex: 'M', w: 31, daira: 'Es Senia', commune: 'Oran', addr: 'Cité Saidoune, Es Senia', phone: '+213 550 88 12 34', email: null, nin: '900168110231005508', ss: 'CASNOS', ssN: '—', chifa: null, allergies: ['aspirine'], blood: 'B-', locale: 'fr', antecedents: ['Diabète type 2', 'Tabagisme sevré 2020'] },
    { first: 'Nour El Houda', last: 'MERZOUK', fr_ar: ['نور الهدى', 'مرزوق'], birth: '2015-01-19', sex: 'F', w: 42, daira: 'Aïn Beïda', commune: 'Oum El Bouaghi', addr: 'Route de Constantine', phone: '+213 662 05 44 77', email: null, nin: null, ss: null, ssN: null, chifa: null, allergies: [], blood: null, locale: 'fr', antecedents: [] },
    { first: 'Abdelhak', last: 'GUERRABI', fr_ar: ['الحق', 'قرابي'], birth: '1955-05-30', sex: 'M', w: 5, daira: 'Arris', commune: 'Batna', addr: 'Village Tiwiline', phone: '+213 771 30 05 60', email: null, nin: null, ss: 'CNMA', ssN: 'CNMA-05-77812', chifa: null, allergies: [], blood: 'O+', locale: 'ar', antecedents: ['BPCO', 'Insuffisance cardiaque NYHA II'] },
    { first: 'Lina', last: 'HAMIDI', fr_ar: ['لينة', 'حميدي'], birth: '1998-09-14', sex: 'F', w: 9, daira: 'Beni Ouartilane', commune: 'Blida', addr: '09 rue Larbi Ben M’hidi', phone: '+213 561 77 23 90', email: 'lina.hmidi@gmail.com', nin: null, ss: null, ssN: null, chifa: null, allergies: [], blood: null, locale: 'es', antecedents: [] },
  ];
  const patientIds: number[] = [];
  for (const p of PATS) {
    const dup = await db.findOne<{ id: number }>('patients', { last_name: String(p.last), first_name: String(p.first) });
    if (dup) { patientIds.push(dup.id); continue; }
    const id = await db.transaction(async (tx) => {
      const { code } = await allocatePatientCode(tx);
      const r = await tx.insert('patients', {
        code, first_name: p.first, last_name: p.last, first_name_ar: (p.fr_ar as string[])[0], last_name_ar: (p.fr_ar as string[])[1],
        birth_date: `${p.birth}T00:00:00.000Z`, sex: p.sex, wilaya_code: Number(p.w), daira: p.daira, commune: p.commune, address: p.addr,
        phone: p.phone, email: p.email, nin: p.nin, chifa_number: p.chifa, ss_fund: p.ss, ss_number: p.ssN, having_right: p.ss ? 1 : 0, third_party_payer: 0,
        blood_group: p.blood, allergies_json: p.allergies, antecedents_json: p.antecedents, attending_practitioner_id: pracIds[Number(p.last === 'BOUDJEMAA' || p.last === 'ZITOUNI' ? 0 : 1)],
        preferred_locale: p.locale, country: 'DZ', consent_json: { granted: true, grantedAt: DAY(-90), scopes: ['records', 'pdf', 'email'] },
        created_at: DAY(-120), updated_at: NOW, created_by: userIds.admin,
      } as Record<string, unknown>);
      return r.id as number;
    });
    patientIds.push(id);
  }
  console.log(`[seed] ${patientIds.length} patients — codes PAT-0000x`);

  /* ------------------------------------------------------------- 9. fiches (dossiers) */
  const mkRecord = async (pi: number, catP: string, typeCode: string, date: string, summary: Record<string, string>, fields: Record<string, unknown>, values?: [string, number][], practitioners: number[] = [], status = 'validated'): Promise<number> => {
    const pat = await db.findOne<{ id: number; code: string }>('patients', { id: pi })!;
    const p = pat;
    const typeId = typeIds.get(`${catP}_${typeCode}`)!;
    const token = (await import('node:crypto')).randomBytes(16).toString('base64url');
    const recId = await db.transaction(async (tx) => {
      const { code } = await allocateRecordCode(p.code, p.id, catP, date, tx);
      const r = await tx.insert('medical_records', {
        code, patient_id: p.id, type_id: typeId, category_prefix: catP, act_date: date, status,
        summary_json: summary, fields_json: fields, icd10_json: catP === 'CON' ? ['R51'] : [], location_id: locIds[catP === 'RAD' || catP === 'GYP' ? 2 : catP === 'LAB' ? 1 : 0],
        author_user_id: userIds.doc, verify_token: token, created_at: date, updated_at: date,
      } as Record<string, unknown>);
      for (const pr of practitioners) await tx.insert('record_practitioners', { record_id: r.id, practitioner_id: pr });
      return r.id as number;
    });
    await ins('verify_tokens', { token, entity_type: 'record', entity_id: recId, entity_code: `${p.code}`, meta_json: { kind: catP, issuedAt: date }, issued_at: NOW, expires_at: null, revoked: 0 });
    if (values) {
      const panelCode = typeCode === 'bio' ? 'BIO' : 'NFS';
      for (const [key, num] of values) {
        const pm = paramBy.get(`${panelCode}.${key}`) as { id: number; unit: string; min: number | null; max: number | null; lo: number | null; hi: number | null } | undefined;
        let flag: 'normal' | 'low' | 'high' | 'critical' = 'normal';
        if (pm) {
          if ((pm.lo != null && num <= pm.lo) || (pm.hi != null && num >= pm.hi)) flag = 'critical';
          else if (pm.min != null && num < pm.min) flag = 'low';
          else if (pm.max != null && num > pm.max) flag = 'high';
        }
        await ins('lab_results', { record_id: recId, parameter_id: pm?.id ?? null, param_key: key, value_num: num, unit: pm?.unit ?? null, ref_min: pm?.min ?? null, ref_max: pm?.max ?? null, flag });
      }
    }
    await ins('history_events', { patient_id: p.id, kind: catP.toLowerCase(), ref_id: recId, ref_code: String((await p).code), actor_user_id: userIds.doc, occurred_at: date, summary_json: summary, detail_json: { fields } });
    return recId;
  };
  const pat1 = patientIds[0];
  const pat2 = patientIds[1];
  const pat3 = patientIds[2];
  const pat4 = patientIds[3];
  const pat5 = patientIds[4];

  await mkRecord(pat1, 'CON', 'generale', DAY(-30, 10), ml('Bilan HTA — tension contrôlée', 'متابعة الضغط — مضبوط', 'Control de HTA', 'Hypertension follow-up'), { motif: 'Contrôle trimestriel HTA', ta_sys: 132, ta_dia: 84, poids: 84, taille: 175, conduite: 'Poursuite amlodipine 5 mg ; contrôle biologique à 3 mois.' }, undefined, [pracIds[1]]);
  await mkRecord(pat1, 'LAB', 'nfs', DAY(-30, 11), ml('NFS — anémie hypochrome modérée', 'تحليل الدم — أنيميا', 'Hemograma', 'CBC — mild anemia'), {}, [['hgb', 10.4], ['leuk', 6.8], ['plt', 512], ['vgm', 76], ['hct', 33]], [pracIds[4]], 'validated');
  await mkRecord(pat2, 'GYP', 'echo_obst', DAY(-7, 9), ml('Écho T3 — croissance satisfaisante', 'صدى الثلاثي الثالث', 'Ecografía T3', '3rd-trimester US'), { sa: 28, rcf: 142, conclusion: 'Croissance harmonieuse, RCF normal, placenta postérieur.' }, undefined, [pracIds[1]]);
  await mkRecord(pat3, 'CAR', 'ecg', DAY(-3, 14), ml('ECG — troubles de la repolarisation', 'تخطيط القلب', 'ECG', 'ECG — repolarization changes'), { fc: 78, rythme: 'sinusal', pr: 168, segments: 'Inversion T V4-V6, discrète', conclusion: 'Anomalies de la repolarisation à corrélérer — écho demandée.' }, undefined, [pracIds[0]]);
  await mkRecord(pat3, 'LAB', 'bio', DAY(-3, 15), ml('Bilan diabétique — HbA1c 8,2 %', 'تحليل السكري', 'Balance diabética', 'Diabetes panel'), {}, [['gly', 2.1], ['crea', 11.2], ['crp', 12], ['hba1c', 8.2], ['tsh', 1.9]] as [string, number][], [pracIds[4]]);
  await mkRecord(pat5, 'RAD', 'rx_thorax', DAY(-2, 10), ml('Rx thorax — surcharge vasculaire', 'أشعة الصدر', 'Rx tórax', 'Chest X-ray'), { indication: 'Dyspnée d’effort', resultat: 'Cardiomégalie modérée, trame vasculaire congestive ; pas d’épanchement.' }, undefined, [pracIds[2]]);
  await mkRecord(pat5, 'SOI', 'pansement', DAY(-1, 8), ml('Soin plaie jambe — cicatrisation correcte', 'علاج جرح الساق', 'Cura de herida', 'Leg wound care'), { site: '1/3 moyen jambe G', geste: 'Parage léger, hydrogel, pansement gras ; rechange à 48 h.' }, undefined, [pracIds[4]]);
  await mkRecord(pat1, 'CAR', 'echo', DAY(0, 9), ml('Écho cardiaque — FEVG 55 %', 'صدى القلب', 'Ecocardiografía', 'ECHO — LVEF 55 %'), { fevg: 55, resume: 'FCG normal, pas d’HTAP. Contrôles 6 mois.' }, undefined, [pracIds[0]], 'draft');

  /* ------------------------------------------------------------- 10. ordonnances */
  const mkRx = async (pi: number, pract: number, date: string, lines: [string, number, string, number, string][], status: 'draft' | 'validated'): Promise<number> => {
    const pat = await db.findOne<{ id: number; code: string }>('patients', { id: pi });
    if (!pat) throw new Error('patient manquant');
    const token = (await import('node:crypto')).randomBytes(16).toString('base64url');
    const rxId = await db.transaction(async (tx) => {
      const { code } = await allocateRecordCode(pat.code, pat.id, 'ORD', date, tx);
      const r = await tx.insert('prescriptions', { code, patient_id: pat.id, practitioner_id: pract, act_date: date, status, locale: 'fr', notes: null, refills: 0, verify_token: token, created_at: date, updated_at: date } as Record<string, unknown>);
      let seq = 1;
      for (const [dci, qty, posology, days, instructions] of lines) {
        const drug = await tx.findOne<{ id: number; dci: string; trade_name: string; form: string; dosage: string; reimbursable: number }>('drugs', { dci });
        await tx.insert('prescription_lines', { prescription_id: r.id, seq: seq++, drug_id: drug?.id ?? null, dci, trade_name: drug?.trade_name ?? dci, form: drug?.form ?? null, dosage: drug?.dosage ?? null, qty, posology, duration_days: days, instructions, reimbursable: drug?.reimbursable ?? 1 });
      }
      return r.id as number;
    });
    await ins('verify_tokens', { token, entity_type: 'prescription', entity_id: rxId, entity_code: String(pat.code), meta_json: { issuedAt: date }, issued_at: NOW, expires_at: null, revoked: 0 });
    if (status === 'validated') await ins('history_events', { patient_id: pat.id, kind: 'rx', ref_id: rxId, ref_code: 'ordonnance validée', actor_user_id: userIds.doc, occurred_at: date, summary_json: ml('Ordonnance délivrée', 'وصفة', 'Receta', 'Prescription issued'), detail_json: null });
    return rxId;
  };
  await mkRx(pat3, pracIds[1], DAY(-3, 16), [['Métformine', 2, '1 cp × 2/jour pendant les repas', 90, 'Contrôle glycémie capillaire si malaise'], ['Amlodipine', 1, '1 cp le matin', 90, '—'], ['Paracétamol', 1, '1 cp si douleur, max 3/j', 5, 'Pas d’AINS (rein)']], 'validated');
  await mkRx(pat1, pracIds[0], DAY(-30, 12), [['Paracétamol', 1, '1 cp × 3/j si douleur', 5, '—']], 'draft');
  const rxTpl = await ins('prescription_templates', { name: ml('Ordonnance typée — antihypertenseur', 'نموذج وصفة', 'Plantilla HTA', 'Hypertension template'), config_json: { heading: { fr: 'Service de cardiologie', ar: 'مصلحة أمراض القلب' }, footer: { fr: 'Contrôle à 3 mois — Cabinet Boumerdès', ar: 'مراقبة بعد 3 أشهر' }, numbering: 'latn', defaultDurationDays: 30 }, is_default: 1, active: 1, created_at: NOW, updated_at: NOW });

  /* ------------------------------------------------------------- 11. agenda & mouvements */
  const APPTS: [number, number, string, string, string][] = [
    [pat2, pracIds[1], DAY(1, 8, 30), 'suivi_grossesse', 'Consultation G3 — 29 SA'],
    [pat1, pracIds[0], DAY(1, 9, 0), 'consultation', 'Contrôle cardiologique post-écho'],
    [pat5, pracIds[2], DAY(2, 10, 0), 'imagerie', 'Scanner thorax (préparation à vérifier)'],
    [pat3, pracIds[1], DAY(4, 11, 0), 'consultation', 'Résultats bilan + ajustement traitement'],
    [pat4, pracIds[1], DAY(5, 9, 30), 'pediatrie', 'Vaccination ROR — rappel'],
  ];
  for (const [pi, pra, start, kind, notes] of APPTS) {
    const end = new Date(new Date(start).getTime() + 30 * 60_000).toISOString();
    const { code } = await allocateSuffixed('appointment', 'RDV');
    await ins('appointments', { code, patient_id: pi, practitioner_id: pra, location_id: locIds[0], start_at: start, end_at: end, kind, status: 'confirmed', notes, all_day: 0, created_by: userIds.sec });
  }
  for (const [pi, from, to, reason, status, at] of [
    [pat5, locIds[0], locIds[2], 'Transfert vers imagerie pour Rx', 'done', DAY(-2, 9, 45)],
    [pat5, locIds[2], locIds[0], 'Retour box cardio après imagerie', 'done', DAY(-2, 11, 10)],
    [pat1, locIds[0], locIds[1], 'Prélèvement NFS sur demande urgente', 'done', DAY(-30, 10, 40)],
  ] as [number, number, number, string, string, string][]) {
    const { code } = await allocateSuffixed('movement', 'MOV');
    await ins('patient_movements', { code, patient_id: pi, from_location_id: from, to_location_id: to, reason, status, at });
  }

  /* ------------------------------------------------------------- 12. GED : deux comptes rendus PDF générés via pdf-lib */
  try {
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const { paths } = await import('../apps/web/src/server/config');
    const fs = await import('node:fs');
    const path = await import('node:path');
    for (const [pi, title, body] of [
      [pat3, 'ECG — 27/09/2026', 'Troubles de la repolarisation V4-V6. A voir.'],
      [pat1, 'Compte-rendu laboratoire NFS', 'Hb 10,4 g/dL — microcytose. Bilan mart'],
    ] as [number, string, string][]) {
      const doc = await PDFDocument.create();
      const page = doc.addPage([595, 842]);
      const font = await doc.embedFont(StandardFonts.Helvetica);
      page.drawText('sarDPI — compte rendu', { x: 48, y: 780, size: 16, font });
      page.drawText(title, { x: 48, y: 750, size: 12, font });
      page.drawText(body, { x: 48, y: 720, size: 11, font });
      const bytes = await doc.save();
      const { code } = await allocateSuffixed('ged', 'CPT');
      const rel = `ged/CPT/${code}_v1.pdf`;
      fs.mkdirSync(path.join(paths.storage, 'ged/CPT'), { recursive: true });
      fs.writeFileSync(path.join(paths.storage, rel), bytes);
      const size = bytes.byteLength;
      const { createHash } = await import('node:crypto');
      const sha = createHash('sha256').update(Buffer.from(bytes)).digest('hex');
      const gid = await ins('ged_documents', { code, type_prefix: 'CPT', patient_id: pi, title, tags_json: ['seed'], note: 'seed', current_version: 1, file_name: `${code}_v1.pdf`, file_path: rel, mime: 'application/pdf', size_bytes: size, sha256: sha, uploaded_by: userIds.admin });
      await ins('ged_versions', { document_id: gid, version: 1, file_name: `${code}_v1.pdf`, file_path: rel, mime: 'application/pdf', size_bytes: size, sha256: sha, note: 'version initiale', created_by: userIds.admin, created_at: NOW });
    }
  } catch (e) {
    console.warn('[seed] GED de démo non générée :', (e as Error).message);
  }

  /* ------------------------------------------------------------- 13. divers */
  if (!(await db.count('external_sources'))) {
    await ins('external_sources', { name: 'Labo Analyse-Plus (local)', kind: 'api', base_url: 'http://192.168.1.40/api/v1', test_path: '/ping', auth_json: { type: 'apikey', value: null }, mapping_json: { results: { path: '$.data[*]', map: { code: 'LAB', patient_ref: 'chifa', panel: 'panel', values: 'items' } } }, active: 0, created_at: NOW, updated_at: NOW });
  }

  const counts = {
    users: await db.count('users'),
    patients: await db.count('patients'),
    records: await db.count('medical_records'),
    prescriptions: await db.count('prescriptions'),
    appointments: await db.count('appointments'),
    drugs: await db.count('drugs'),
  };
  console.table(counts);
  console.log('[seed] ✓ terminé.');
  console.log('[seed] Connexion : admin / Mot de passe : SARDPI_ADMIN_PASSWORD ou « Admin!2026-dz » (À CHANGER).');
  await db.close();
}

main().catch((e) => {
  console.error('[seed] échec :', e);
  process.exit(1);
});
