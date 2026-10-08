/**
 * ENDPOINTS PUBLICS & DOCUMENTAIRES.
 *  - GET /verify/:token — page/API de VALIDATION d'authenticité : renvoie UNIQUEMENT le type, le code métier,
 *    la date d'émission et l'état — AUCUNE donnée nominative (le QR ne pointe jamais vers l'id).
 *  - GET /files/:token — diffusion de fichier par URL signée expirante.
 *  - GET /documents/:code/print — même gabarit que le PDF, pour « Imprimer → Enregistrer PDF » (arabe RTL ok).
 *  - GET /documents/:code.pdf — Puppeteer si disponible, sinon 501 + redirection print.
 *  - GET /i18n/:lang/:ns — ETag + cache HTTP ; rechargement à chaud côté serveur.
 *  - GET /scan — recherche par code scanné (authentifié, permission).
 */
import { route, type Ctx } from '../http/router';
import { getDb } from '../data';
import { notFound, ApiError } from '../http/errors';
import { loadNamespace, getLanguages, i18nHealth } from '../i18n/server';
import { resolveFileToken } from '../storage';
import { readFile } from '../storage';
import { renderDocHtml, escHtml, type DocSpec } from '../pdf';
import { pdfAvailable, renderPdf } from '../pdf';
import { pickLabel, patientCodeFromRecord } from '@sardpi/shared';
import { env } from '../config';
import { t } from '../i18n/server';
import { qrSvg, verifyUrl } from '../qr';
import { getActiveProfile } from '../country';
import { sanitizeRow } from '../http/crud';
import { hydrateRow } from '../data/cast';

/* ------------------------------------------------------------------ i18n */
route({
  method: 'GET',
  path: '/i18n/:lang/:ns',
  auth: false,
  licenseFree: true,
  cacheable: true,
  async handler(ctx: Ctx) {
    const m = getLanguages();
    const lang = m.languages.some((l) => l.code === ctx.params.lang) ? String(ctx.params.lang) : m.fallback;
    const nsRaw = String(ctx.params.ns ?? 'common').replace(/\.json$/, '');
    const ns = m.namespaces.includes(nsRaw) ? nsRaw : 'common';
    const cache = loadNamespace(lang, ns);
    const etag = `"${cache.etag}"`;
    const inm = ctx.req.headers.get('if-none-match');
    if (inm === etag) return new Response(null, { status: 304, headers: { etag, 'cache-control': 'public, max-age=60, stale-while-revalidate=300' } });
    const dir = m.languages.find((l) => l.code === lang)?.dir ?? 'ltr';
    // Fusion avec la langue de secours pour les clés manquantes : l'UI n'affiche JAMAIS de clé brute.
    let data = cache.data;
    if (lang !== m.fallback) {
      const fb = loadNamespace(m.fallback, ns).data;
      const missing = Object.keys(fb).filter((k) => data[k] === undefined);
      if (missing.length) {
        data = { ...fb, ...data };
        void (async () => {
          const { reportClientMissing } = await import('../i18n/server');
          reportClientMissing(lang, ns, missing);
        })().catch(() => undefined);
      }
    }
    return new Response(
      JSON.stringify({ lang, ns, dir, data, meta: { fallback: m.fallback } }),
      { headers: { 'content-type': 'application/json; charset=utf-8', etag, 'cache-control': 'public, max-age=60, stale-while-revalidate=300', vary: 'Accept-Language' } },
    );
  },
});

route({ method: 'GET', path: '/i18n', auth: false, licenseFree: true, cacheable: true, handler: async () => ({ ...i18nHealth(), manifest: { default: getLanguages().default, fallback: getLanguages().fallback, namespaces: getLanguages().namespaces, languages: getLanguages().languages.map((l) => ({ code: l.code, dir: l.dir, font: l.font, name: l.name })) } }) });

/* --------------------------------------------------------------- vérif. */
async function lookupVerify(token: string) {
  const db = await getDb();
  const vt = await db.findOne<Record<string, unknown>>('verify_tokens', { token });
  if (!vt || Number(vt.revoked)) return null;
  const meta = (typeof vt.meta_json === 'string' ? JSON.parse(String(vt.meta_json)) : vt.meta_json) as Record<string, unknown> | null;
  const expired = vt.expires_at ? new Date(String(vt.expires_at)) < new Date() : false;
  return {
    ok: !expired,
    revoked: false,
    entity: vt.entity_type,
    code: vt.entity_code,
    issuedAt: vt.issued_at,
    expiresAt: vt.expires_at,
    meta,
  };
}

/* ------------------------------------------------------------------ health */
route({
  method: 'GET',
  path: '/health',
  auth: false,
  licenseFree: true,
  cacheable: false,
  async handler() {
    const { health } = await import('../data');
    const h = await health();
    return { status: h.ok ? 'ok' : 'degraded', ...h, at: new Date().toISOString() };
  },
});

route({ method: 'GET', path: '/verify/:token', auth: false, licenseFree: true, cacheable: false, handler: async (ctx: Ctx) => await lookupVerify(String(ctx.params.token ?? '')) ?? { ok: false, error: 'errors.invalidToken' } });

/* ----------------------------------------------------------------- scan */
route({
  method: 'GET',
  path: '/scan',
  perm: ['patient', 'view'],
  async handler(ctx: Ctx) {
    const code = String(ctx.query.get('code') ?? '').trim().toUpperCase();
    if (!code) return { found: false };
    const db = ctx.db;
    let patient = await db.findOne<Record<string, unknown>>('patients', { code });
    let kind = 'patient';
    let id = patient ? Number(patient.id) : null;
    if (!patient) {
      const rec = await db.findOne<Record<string, unknown>>('medical_records', { code });
      if (rec) {
        kind = 'record';
        id = Number(rec.id);
        patient = await db.findOne<Record<string, unknown>>('patients', { id: Number(rec.patient_id) });
      } else {
        const rx = await db.findOne<Record<string, unknown>>('prescriptions', { code });
        if (rx) {
          kind = 'prescription';
          id = Number(rx.id);
          patient = await db.findOne<Record<string, unknown>>('patients', { id: Number(rx.patient_id) });
        } else {
          const pcode = patientCodeFromRecord(code);
          if (pcode) {
            patient = await db.findOne<Record<string, unknown>>('patients', { code: pcode });
            kind = 'patient';
            id = patient ? Number(patient.id) : null;
          }
        }
      }
    }
    if (!patient) return { found: false, kind, id };
    return { found: true, kind, id, patient: { id: Number(patient.id), code: patient.code, name: `${String(patient.last_name).toUpperCase()} ${patient.first_name}` } };
  },
});

/**
 * GET /qr?data=… — rendu SVG d’un QR (badges, ordonnances, étiquettes) — jamais de données sensibles dans l’URL publique.
 * Route PUBLIQUE à dessein : l’image est appelée par `<img src>` (aucun en-tête Authorization possible) et le
 * contenu du QR est déjà destiné à être scanné par un tiers non authentifié (page /verify/:token publique).
 * Sans `auth: false`, toute vignette QR de l’application répondait 401 (constaté dans la console navigateur).
 */
route({
  method: 'GET',
  path: '/qr',
  auth: false,
  licenseFree: true,
  async handler(ctx: Ctx) {
    const data = String(ctx.query.get('data') ?? '').slice(0, 900);
    if (!data) throw new ApiError(400, 'errors.validation');
    const { qrSvg } = await import('../qr');
    const svg = await qrSvg(data, { size: 220 });
    return new Response(svg, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'private, no-store' } });
  },
});

/* --------------------------------------------------------------- fichiers */
route({
  method: 'GET',
  path: '/files/:token',
  auth: false,
  licenseFree: true,
  async handler(ctx: Ctx) {
    const r = await resolveFileToken(String(ctx.params.token ?? ''));
    if (!r) throw notFound();
    if (r.expired) return new Response('expired', { status: 410 });
    const buf = readFile(r.relPath);
    if (!buf) throw notFound();
    const download = ctx.query.get('download') === '1';
    const name = r.relPath.split('/').pop();
    return new Response(buf as unknown as BodyInit, {
      headers: {
        'content-type': guessMime(name ?? ''),
        'content-length': String(buf.length),
        'cache-control': 'private, max-age=60',
        ...(download ? { 'content-disposition': `attachment; filename="${name}"` } : {}),
      },
    });
  },
  noRate: true,
});

function guessMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  return ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : ext === 'tif' || ext === 'tiff' ? 'image/tiff' : 'application/octet-stream';
}

/* ------------------------------------------------- documents : print / pdf */
async function buildSpecFor(code: string, lang: string, ctx: Ctx): Promise<DocSpec | null> {
  const db = ctx.db;
  const { getSection } = await import('../settings');
  const g = (await getSection('general')) as Record<string, string>;
  const { profile } = await getActiveProfile();
  const clinic = { name: String(g.orgName ?? 'sarDPI'), address: String(g.orgAddress ?? ''), phone: String(g.orgPhone ?? ''), email: String(g.orgEmail ?? '') };
  const m = getLanguages();
  const dir = m.languages.find((l) => l.code === lang)?.dir ?? 'ltr';
  const fmtDate = (iso: unknown) => (iso ? new Intl.DateTimeFormat(lang === 'ar' ? 'ar-DZ' : lang, { dateStyle: 'long', timeStyle: 'short', timeZone: profile?.timezone }).format(new Date(String(iso))) : '');
  const rec = await db.findOne<Record<string, unknown>>('medical_records', { code });
  if (rec) {
    const type = await db.findOne<Record<string, unknown>>('intervention_types', { id: Number(rec.type_id) });
    const patientRaw = await db.findOne<Record<string, unknown>>('patients', { id: Number(rec.patient_id) });
    const patient = patientRaw ? (hydrateRow('patients', patientRaw) as Record<string, unknown>) : null;
    const lab = await db.find<Record<string, unknown>>('lab_results', { where: { record_id: Number(rec.id) } });
    const location = rec.location_id ? await db.findOne<Record<string, unknown>>('locations', { id: Number(rec.location_id) }) : null;
    const team = await db.find<Record<string, unknown>>('record_practitioners', { where: { record_id: Number(rec.id) } });
    const practs = team.length ? await Promise.all(team.map((tp) => db.findOne<Record<string, unknown>>('practitioners', { id: Number(tp.practitioner_id) }))) : [];
    const practNames = practs.filter(Boolean).map((p) => `${String(p?.last_name ?? '').toUpperCase()} ${p?.first_name ?? ''}`.trim()).filter(Boolean).join(', ');

    // 1. Données du patient (bloc standard configurable)
    const patientRows: [string, string][] = [];
    if (patient) {
      patientRows.push([
        lang === 'ar' ? 'الاسم واللقب' : 'Nom & Prénom',
        `${String(patient.last_name ?? '').toUpperCase()} ${patient.first_name ?? ''}${patient.last_name_ar || patient.first_name_ar ? ` (${patient.last_name_ar ?? ''} ${patient.first_name_ar ?? ''})` : ''}`.trim(),
      ]);
      patientRows.push([lang === 'ar' ? 'رمز المريض' : 'Code patient', String(patient.code ?? '')]);
      if (patient.birth_date) {
        const b = String(patient.birth_date).slice(0, 10);
        const age = Math.floor((Date.now() - new Date(b).getTime()) / (365.25 * 24 * 3600 * 1000));
        patientRows.push([
          lang === 'ar' ? 'تاريخ الميلاد / السن' : 'Date de naissance / Âge',
          `${b}${age > 0 ? ` (${age} ${lang === 'ar' ? 'سنة' : 'ans'})` : ''}`,
        ]);
      }
      if (patient.sex) {
        patientRows.push([
          lang === 'ar' ? 'الجنس' : 'Sexe',
          patient.sex === 'M' ? (lang === 'ar' ? 'ذكر' : 'Masculin (M)') : patient.sex === 'F' ? (lang === 'ar' ? 'أنثى' : 'Féminin (F)') : String(patient.sex),
        ]);
      }
      const isEnc = (v: unknown) => typeof v === 'string' && v.startsWith('ENCv1.');
      if (patient.phone && !isEnc(patient.phone)) {
        patientRows.push([lang === 'ar' ? 'الهاتف' : 'Téléphone', String(patient.phone)]);
      }
      const ss = patient.chifa_number ?? patient.ss_number;
      if (ss && !isEnc(ss)) {
        patientRows.push([
          lang === 'ar' ? 'الضمان الاجتماعي / الشفاء' : 'N° Sécurité sociale / Chifa',
          String(ss),
        ]);
      }
      if (patient.blood_group && !isEnc(patient.blood_group)) {
        patientRows.push([lang === 'ar' ? 'فصيلة الدم' : 'Groupe sanguin', String(patient.blood_group)]);
      }
      const addrParts = [patient.address && !isEnc(patient.address) ? patient.address : null, patient.commune, patient.wilaya].filter(Boolean);
      if (addrParts.length) {
        patientRows.push([
          lang === 'ar' ? 'العنوان' : 'Adresse',
          addrParts.join(', '),
        ]);
      }
    }
    if (location) {
      const locLabel = pickLabel((location.name_json ?? {}) as never, lang) || location.name || location.building || location.code;
      patientRows.push([lang === 'ar' ? 'مكان الفحص' : 'Lieu d’intervention', String(locLabel)]);
    }
    if (practNames) {
      patientRows.push([lang === 'ar' ? 'الممارس / الفريق' : 'Praticien / Équipe', practNames]);
    }

    // 2. Détails & données de l'acte / examen
    const fields = (typeof rec.fields_json === 'string' ? JSON.parse(String(rec.fields_json)) : rec.fields_json ?? {}) as Record<string, unknown>;
    const defs = (typeof type?.fields_json === 'string' ? JSON.parse(String(type.fields_json)) : (type?.fields_json ?? [])) as { key: string; label?: Record<string, string>; kind?: string }[];
    const examRows: [string, string][] = defs
      .filter((d) => fields[d.key] !== undefined && fields[d.key] !== null && fields[d.key] !== '')
      .map((d) => [pickLabel(d.label ?? {}, lang) || d.key, String(Array.isArray(fields[d.key]) ? (fields[d.key] as unknown[]).join(', ') : fields[d.key])]);

    // 3. Tableau des contrôles et résultats de laboratoire
    const blocks: DocSpec['blocks'] = [];
    if (patientRows.length) {
      blocks.push({ heading: t(lang, 'pdf', 'pdf.patient'), rows: patientRows });
    }
    if (examRows.length) {
      blocks.push({ heading: lang === 'ar' ? 'بيانات وتفاصيل الفحص' : 'Détails & données de l’examen', rows: examRows });
    }

    // Résultats depuis lab_results ou values_json
    let labItems = lab;
    if (!labItems.length && rec.values_json) {
      try {
        const vj = typeof rec.values_json === 'string' ? JSON.parse(String(rec.values_json)) : rec.values_json;
        if (Array.isArray(vj)) {
          labItems = vj.map((x: Record<string, unknown>) => ({
            param_key: x.parameterKey ?? x.param_key ?? x.key,
            value_num: typeof x.value === 'number' ? x.value : null,
            value_txt: typeof x.value === 'number' ? null : String(x.value ?? ''),
            unit: x.unit ?? '',
            ref_min: x.refLow ?? x.ref_min ?? null,
            ref_max: x.refHigh ?? x.ref_max ?? null,
            flag: x.flag ?? 'normal',
          }));
        }
      } catch {
        // ignore
      }
    }

    if (labItems.length) {
      blocks.push({
        heading: t(lang, 'lab', 'lab.values'),
        table: {
          head: [
            t(lang, 'lab', 'lab.parameter'),
            t(lang, 'lab', 'lab.result'),
            t(lang, 'lab', 'lab.unit'),
            t(lang, 'lab', 'lab.refRange'),
            t(lang, 'lab', 'lab.flag'),
          ],
          rows: labItems.map((l) => [
            escHtml(String(l.param_key).toUpperCase()),
            `<c><b class="num">${l.value_num != null ? Number(l.value_num) : escHtml(String(l.value_txt ?? ''))}</b></c>`,
            escHtml(String(l.unit ?? '')),
            l.ref_min != null || l.ref_max != null ? `${l.ref_min ?? ''} – ${l.ref_max ?? ''}` : '—',
            `<c><span class="flag-${l.flag}">${escHtml(t(lang, 'lab', `lab.${l.flag === 'normal' ? 'normal' : l.flag}`)) || escHtml(String(l.flag))}</span></c>`,
          ]),
        },
      });
    }

    const summary = rec.summary_json ? pickLabel(rec.summary_json as never, lang) : String(rec.code);
    return {
      kind: String(rec.category_prefix) === 'LAB' ? 'lab' : 'report',
      title: { [lang]: summary || pickLabel((type?.name_json ?? {}) as never, lang) } as never,
      subtitle: type ? pickLabel(type.name_json as never, lang) : undefined,
      lang,
      dir,
      numbering: ((profile?.documents as { numbering?: string[] } | undefined)?.numbering?.[0] === 'arab') && lang === 'ar' ? 'arab' : 'latn',
      clinic,
      meta: {
        code: String(rec.code),
        date: fmtDate(rec.act_date),
        patientLine: patient ? `${String(patient.last_name).toUpperCase()} ${patient.first_name} — ${patient.code}` : undefined,
        practitioner: practNames || undefined,
      },
      blocks,
      qr: rec.verify_token ? { svg: await qrSvg(verifyUrl(env.appUrl, String(rec.verify_token)), { size: 92 }), caption: t(lang, 'pdf', 'pdf.verify') } : undefined,
      stamp: { signHere: true },
      confidentialNote: t(lang, 'pdf', 'pdf.confidential'),
    };
  }
  const rx = await db.findOne<Record<string, unknown>>('prescriptions', { code });
  if (rx) {
    const patientRaw = await db.findOne<Record<string, unknown>>('patients', { id: Number(rx.patient_id) });
    const patient = patientRaw ? (hydrateRow('patients', patientRaw) as Record<string, unknown>) : null;
    const pract = await db.findOne<Record<string, unknown>>('practitioners', { id: Number(rx.practitioner_id) });
    const lines = await db.find<Record<string, unknown>>('prescription_lines', { where: { prescription_id: Number(rx.id) }, orderBy: [['seq', 'asc']] });
    let stampSvg: string | undefined;
    let sigSvg: string | undefined;
    for (const [assetId, setter] of [[pract?.stamp_asset_id, (v: string) => (stampSvg = v)], [pract?.signature_asset_id, (v: string) => (sigSvg = v)]] as const) {
      if (assetId) {
        const a = await db.findOne<Record<string, unknown>>('assets', { id: Number(assetId) });
        if (a) {
          const buf = readFile(String(a.file_path));
          if (buf) setter(`data:${a.mime};base64,${buf.toString('base64')}`);
        }
      }
    }
    let tplCfg: Record<string, unknown> = {};
    if (rx.template_id) {
      const tpl = await db.findOne<Record<string, unknown>>('prescription_templates', { id: Number(rx.template_id) });
      if (tpl) tplCfg = typeof tpl.config_json === 'string' ? JSON.parse(String(tpl.config_json)) : (tpl.config_json as Record<string, unknown>);
    }
    return {
      kind: 'rx',
      title: { fr: 'Ordonnance médicale', ar: 'وصفة طبية', es: 'Receta médica', en: 'Medical prescription' } as never,
      lang,
      dir,
      numbering: tplCfg.numbering === 'arab' ? 'arab' : 'latn',
      clinic: { ...clinic, ...(tplCfg.header as object) },
      meta: {
        code: String(rx.code),
        date: fmtDate(rx.act_date),
        patientLine: patient ? `${String(patient.last_name).toUpperCase()} ${patient.first_name} — ${patient.birth_date ? new Date(String(patient.birth_date)).toLocaleDateString(lang === 'ar' ? 'ar-DZ' : lang) : ''}` : undefined,
        practitioner: pract ? `Dr ${pract.last_name} ${pract.first_name}${pract.order_number ? ` — ${pract.order_number}` : ''}` : undefined,
      },
      blocks: [
        {
          heading: t(lang, 'pdf', 'pdf.patient'),
          html: `<ul class="rx">${lines
            .map((l, i) => {
              // La quantité (colonne « qty ») manquait sur le document imprimé : le pharmacien
              // n'avait aucun moyen de connaître le nombre de boîtes à délivrer.
              const qty = Number(l.qty ?? 0);
              const qtyHtml = Number.isFinite(qty) && qty > 0 ? `<span class="qty"> · ${t(lang, 'pharmacy', 'pharmacy.quantity')} : ${qty}</span>` : '';
              return `<li><span class="dn">${i + 1}. ${l.dci ? `<span class="code">${l.dci}</span> — ` : ''}${l.trade_name}${l.dosage ? ` ${l.dosage}` : ''}${l.form ? ` (${l.form})` : ''}</span>${qtyHtml}<br><span class="ps">${l.posology}</span>${l.instructions ? `<br><span class="co">${l.instructions}</span>` : ''}</li>`;
            })
            .join('')}</ul>`,
        },
        ...(rx.notes ? [{ heading: t(lang, 'common', 'common.notes'), note: String(rx.notes) }] : []),
      ],
      footer: [rx.refills ? `${t(lang, 'pdf', 'pdf.date')} + ${rx.refills} ${t(lang, 'pharmacy', 'pharmacy.quantity')}` : '', tplCfg.footer ? String(tplCfg.footer) : ''].filter(Boolean).join(' · '),
      qr: rx.verify_token ? { svg: await qrSvg(verifyUrl(env.appUrl, String(rx.verify_token)), { size: 92 }), caption: t(lang, 'pdf', 'pdf.verify') } : undefined,
      stamp: { signatureSvgOrImg: sigSvg, stampSvgOrImg: stampSvg, signHere: !sigSvg },
      colors: (tplCfg.colors as DocSpec['colors']) ?? undefined,
      confidentialNote: t(lang, 'pdf', 'pdf.confidential'),
    };
  }
  const patientByCode = await db.findOne<Record<string, unknown>>('patients', { code });
  if (patientByCode) {
    return {
      kind: 'patient',
      title: { fr: 'Fiche patient', ar: 'بطاقة مريض', es: 'Ficha del paciente', en: 'Patient record' } as never,
      lang,
      dir,
      clinic,
      meta: { code: String(patientByCode.code), date: fmtDate(patientByCode.updated_at ?? new Date()) },
      blocks: [
        {
          rows: [
            [t(lang, 'patient', 'patient.lastName'), String(patientByCode.last_name ?? '')],
            [t(lang, 'patient', 'patient.firstName'), String(patientByCode.first_name ?? '')],
            ...(patientByCode.last_name_ar ? ([[t(lang, 'patient', 'patient.lastNameAr'), String(patientByCode.last_name_ar)]] as [string, string][]) : []),
            [t(lang, 'patient', 'patient.birthDate'), patientByCode.birth_date ? new Date(String(patientByCode.birth_date)).toLocaleDateString(lang === 'ar' ? 'ar-DZ' : lang) : '—'],
            [t(lang, 'patient', 'patient.sex'), patientByCode.sex === 'F' ? t(lang, 'common', 'sex.female') : t(lang, 'common', 'sex.male')],
            [t(lang, 'patient', 'patient.phone'), String(patientByCode.phone ?? '—')],
            [t(lang, 'patient', 'patient.address'), String(patientByCode.address ?? '—')],
            [t(lang, 'patient', 'patient.chifa'), String(patientByCode.chifa_number ?? '—')],
          ],
        },
      ],
      confidentialNote: t(lang, 'pdf', 'pdf.confidential'),
    };
  }
  return null;
}

route({
  method: 'GET',
  path: '/documents/:code/print',
  perm: ['patient', 'view'],
  async handler(ctx: Ctx) {
    const code = String(ctx.params.code).toUpperCase();
    const lang = ctx.query.get('lang') ?? ctx.user?.locale ?? 'fr';
    const spec = await buildSpecFor(code, lang, ctx);
    if (!spec) throw notFound();
    const html = renderDocHtml(spec);
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store' } });
  },
});

route({
  method: 'GET',
  path: '/documents/:code/pdf',
  perm: ['patient', 'print'],
  async handler(ctx: Ctx) {
    const code = String(ctx.params.code).toUpperCase();
    const lang = ctx.query.get('lang') ?? ctx.user?.locale ?? 'fr';
    const spec = await buildSpecFor(code, lang, ctx);
    if (!spec) throw notFound();
    if (!(await pdfAvailable())) {
      return Response.json(
        { error: { code: 'pdf.unavailable', message: 'Puppeteer non installé : utilisez « Imprimer → Enregistrer au format PDF » (gabarit identique).', printUrl: `/api/v1/documents/${encodeURIComponent(code)}/print?lang=${lang}` } },
        { status: 501 },
      );
    }
    const buf = await renderPdf(renderDocHtml(spec));
    if (!buf) return Response.json({ error: { code: 'errors.server', message: 'échec de rendu PDF' } }, { status: 500 });
    return new Response(buf as unknown as BodyInit, { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${code}.pdf"`, 'cache-control': 'private, no-store' } });
  },
});

/** Vérification par code (sans token) côté app — contrôle visuel rapide depuis n'importe quel écran. */
route({
  method: 'GET',
  path: '/verify-code/:code',
  perm: ['patient', 'view'],
  async handler(ctx: Ctx) {
    const code = String(ctx.params.code).toUpperCase();
    const db = ctx.db;
    const patient = patientCodeFromRecord(code);
    const rec = patient ? await db.findOne('medical_records', { code }) : null;
    const rx = !rec ? await db.findOne('prescriptions', { code }) : null;
    const found = Boolean(rec || rx || (await db.findOne('patients', { code })));
    return { code, found, kind: rec ? 'record' : rx ? 'prescription' : found ? 'patient' : null };
  },
});

void sanitizeRow;

/** Les routes de ce module s'enregistrent à l'import (effet de module) — la fonction est un point d'appel unifié. */
export function registerPublic(): void {
  // no-op: registration occurs on import
}
