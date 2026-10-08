'use client';

/**
 * Liste & CRUD « fiches » d'une catégorie d'intervention (module dynamique : consultation, labo, etc.).
 * Types configurés en base, statuts traduits dans la langue active, sélection interactive du patient
 * par autocomplétion, sélection du RDV lié avec création rapide, sélection du lieu avec sous-modale,
 * et affichage strict des titres dans la langue courante.
 */
import React, { useMemo } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui';
import { BizCode } from '@/components/biz-code';
import { CrudModule, fmtVal } from '@/components/crud';
import { useT } from '@/lib/i18n';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { medicalRecordCreateZ, pickLabel } from '@sardpi/shared';
import { RecordFields, type FieldConfig } from '@/components/record-fields';
import { PatientAutocompletePicker, ApptPicker, LocationPicker } from '@/components/record-form-fields';

/** Parse fields_json (objet ou chaîne JSON) en dictionnaire clé→valeur pour RecordFields. */
function parseVals(v: unknown): Record<string, string | number | boolean | null | undefined> {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, string | number | boolean | null | undefined>;
  if (typeof v === 'string' && v) {
    try {
      const o = JSON.parse(v);
      return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, string | number | boolean | null | undefined>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function recordStatusLabel(s: unknown, t: (k: string) => string): string {
  const k = String(s ?? '');
  if (k === 'draft') return t('records.st.draft');
  if (k === 'validated') return t('records.st.validated');
  if (k === 'cancelled') return t('records.st.cancelled');
  if (k === 'in_progress') return t('records.st.in_progress');
  if (k === 'awaiting_results' || k === 'awaiting') return t('records.st.awaiting');
  return k;
}

export default function RecordsModulePage(): React.ReactElement {
  const params = useParams<{ module: string }>();
  const category = params.module;
  const sp = useSearchParams();
  // deep-link agenda/dossier : ?new=1&patient=<id>&appt=<id> → création pré-remplie
  const autoCreate = sp?.get('new') === '1';
  const prePatient = sp?.get('patient');
  const preAppt = sp?.get('appt');

  const { t } = useT('patient');
  const { t: tc, lang } = useT('common');
  const has = useAuth((s) => s.has);

  const catalog = useQuery({
    queryKey: ['catalog'],
    queryFn: () =>
      api.get<{
        categories: { id: number; module: string; prefix: string; code: string; label_json: Record<string, string> }[];
        types: { id: number; category_prefix: string; code: string; name_json: Record<string, string>; active: number }[];
      }>('/refs/catalog'),
  });

  const cat = useMemo(() => {
    const key = String(category ?? '').trim();
    const lower = key.toLowerCase();
    return (
      (catalog.data?.categories ?? []).find(
        (c) =>
          c.module === key ||
          c.module.toLowerCase() === lower ||
          c.prefix === key ||
          c.prefix.toLowerCase() === lower ||
          c.code === key ||
          c.code.toLowerCase() === lower,
      ) ?? null
    );
  }, [catalog.data, category]);

  const types = useMemo(
    () => (catalog.data?.types ?? []).filter((x) => cat != null && x.category_prefix === cat.prefix && Boolean(Number(x.active))),
    [catalog.data, cat],
  );

  const createDefaults = useMemo(() => {
    const d: Record<string, unknown> = {
      actDate: new Date().toISOString().slice(0, 10),
      status: 'draft',
      typeId: types[0]?.id ? String(types[0].id) : undefined,
    };
    if (prePatient) d.patientId = String(prePatient);
    if (preAppt) d.apptId = String(preAppt);
    return d;
  }, [prePatient, preAppt, types]);

  const can = has(category, 'create') || has('records', 'create');

  if (!cat) return <div className="skeleton h-40" />;

  const statusTone = (s: unknown): 'ok' | 'danger' | 'warn' => (s === 'validated' ? 'ok' : s === 'cancelled' ? 'danger' : 'warn');

  return (
    <CrudModule
      resource="records"
      title={`${pickLabel(cat.label_json, lang)}`}
      subtitle={
        <span className="inline-flex items-center gap-2">
          <Badge tone="info">{cat.prefix}</Badge> {t('records.subtitle')}
        </span>
      }
      scopeSelect
      canExport={false}
      defaultSort={{ id: 'id', desc: true }}
      canCreate={can}
      canUpdate={has(category, 'update') || has('records', 'update')}
      canArchive={has(category, 'archive') || has('records', 'archive')}
      createLabel={t('records.new')}
      extraQuery={{ category }}
      schema={medicalRecordCreateZ}
      cardTitle={(r) => {
        const summaryText = pickLabel(r.summary_json as never, lang) || (typeof r.summary === 'string' ? r.summary : pickLabel(r.summary as never, lang)) || r.title;
        return fmtVal(summaryText || r.type_label);
      }}
      cardSubtitle={(r) => (
        <span className="flex items-center gap-2">
          <BizCode code={r.code as string} />
          <span>{fmtVal(r.patient_name ?? r.patient_code)}</span>
        </span>
      )}
      cardBadges={(r) => (
        <>
          <Badge tone={statusTone(r.status)}>{recordStatusLabel(r.status, t)}</Badge>
          <Badge>{fmtVal(r.type_label)}</Badge>
        </>
      )}
      columns={[
        { key: 'code', label: tc('code'), width: '210px', render: (r) => <BizCode code={r.code as string} copy /> },
        { key: 'act_date', label: tc('date'), sortable: true, width: '96px', render: (r) => <span className="font-mono text-[12px]">{fmtVal(r.act_date).slice(0, 10)}</span> },
        {
          key: 'title',
          label: tc('title'),
          render: (r) => {
            const summaryText = pickLabel(r.summary_json as never, lang) || (typeof r.summary === 'string' ? r.summary : pickLabel(r.summary as never, lang)) || r.title;
            return <span className="font-semibold">{fmtVal(summaryText || r.type_label)}</span>;
          },
        },
        { key: 'type_label', label: t('records.type'), width: '160px', render: (r) => <Badge>{fmtVal(r.type_label ?? r.type_id)}</Badge> },
        { key: 'patient_code', label: t('field.patient'), width: '130px', render: (r) => <BizCode code={(r.patient_code as string) ?? null} /> },
        { key: 'practitioners', label: t('records.team'), hideByDefault: true, render: (r) => (Array.isArray(r.practitioners) ? (r.practitioners as { last_name?: string }[]).map((p) => p.last_name).join(', ') : '—') },
        {
          key: 'status',
          label: t('records.status'),
          width: '110px',
          render: (r) => <Badge tone={statusTone(r.status)}>{recordStatusLabel(r.status, t)}</Badge>,
        },
        { key: 'results', label: t('lab.results'), hideByDefault: true, render: (r) => <Badge tone="info">{Array.isArray(r.results) ? `${(r.results as unknown[]).length}` : '0'}</Badge> },
      ]}
      filterFields={[
        { field: 'act_date', label: tc('date'), kind: 'date' },
        {
          field: 'status',
          label: t('records.status'),
          kind: 'select',
          options: [
            { value: 'draft', label: t('records.st.draft') },
            { value: 'in_progress', label: t('records.st.in_progress') },
            { value: 'validated', label: t('records.st.validated') },
            { value: 'cancelled', label: t('records.st.cancelled') },
          ],
        },
      ]}
      fields={[
        {
          key: 'patientId',
          label: t('field.patient'),
          kind: 'custom',
          required: true,
          renderInput: ({ value, setValue, setFieldValue }) => (
            <PatientAutocompletePicker
              value={value}
              onChange={(newId) => {
                setValue(newId);
                setFieldValue('apptId', '');
              }}
            />
          ),
        },
        {
          key: 'typeId',
          label: t('records.type'),
          kind: 'select',
          required: true,
          options: types.map((x) => ({
            value: String(x.id),
            label: `${x.code} — ${pickLabel(x.name_json, lang)}`,
          })),
        },
        { key: 'actDate', label: tc('date'), kind: 'date', required: true },
        {
          key: 'status',
          label: t('records.status'),
          kind: 'select',
          options: [
            { value: 'draft', label: t('records.st.draft') },
            { value: 'in_progress', label: t('records.st.in_progress') },
            { value: 'validated', label: t('records.st.validated') },
            { value: 'cancelled', label: t('records.st.cancelled') },
          ],
        },
        {
          key: 'apptId',
          label: t('records.appt'),
          kind: 'custom',
          hint: t('records.apptHint'),
          renderInput: ({ value, setValue, watch }) => (
            <ApptPicker
              patientId={watch('patientId')}
              value={value}
              onChange={(id) => setValue(id)}
            />
          ),
        },
        {
          key: 'locationId',
          label: t('records.location'),
          kind: 'custom',
          renderInput: ({ value, setValue }) => (
            <LocationPicker
              value={value}
              onChange={(id) => setValue(id)}
              lang={lang}
            />
          ),
        },
        { key: 'summaryFr', label: `${tc('title')} (FR)` },
        { key: 'summaryAr', label: `${tc('title')} (ع)` },
        { key: 'practitionerIdsCsv', label: t('records.team'), hint: t('field.csvIdsHint'), colSpan: 2 },
        { key: 'icd10Csv', label: 'ICD-10', hint: 'S06.0, J18.9' },
        { key: 'fieldsJson', label: t('records.fields'), kind: 'json', hint: t('records.fieldsHint'), colSpan: 2 },
        { key: 'valuesJson', label: t('records.values'), kind: 'json', hint: t('records.valuesHint'), colSpan: 2 },
        { key: 'attachmentsCsv', label: t('records.attachments'), hint: t('records.attachmentsHint'), colSpan: 2 },
      ]}
      autoCreate={autoCreate}
      createDefaults={createDefaults}
      transformCreate={(v) => parseRecord(v)}
      transformUpdate={(v) => parseRecord(v)}
      detail={(r) => (
        <div className="flex flex-col gap-2 text-[13px]">
          <div className="flex flex-wrap gap-2">
            <Badge tone="info">{fmtVal(r.type_label)}</Badge>
            <Badge tone={statusTone(r.status)}>{recordStatusLabel(r.status, t)}</Badge>
            <span className="font-mono text-[12px] text-[rgb(var(--c-muted))]">{fmtVal(r.act_date)}</span>
          </div>

          {/* Affichage strict du titre dans la langue active uniquement */}
          {(() => {
            const activeSummary =
              pickLabel(r.summary_json as never, lang) ||
              (typeof r.summary === 'string' ? r.summary : pickLabel(r.summary as never, lang)) ||
              r.title;
            if (!activeSummary) return null;
            return (
              <div className="rounded-xl bg-[rgb(var(--c-surface-2))] p-3" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                <span className="font-semibold">{String(activeSummary)}</span>
              </div>
            );
          })()}

          <div className="flex flex-col gap-1.5">
            <h4 className="text-[12px] font-bold text-[rgb(var(--c-muted))]">{t('records.fields')}</h4>
            <RecordFields config={(Array.isArray(r.type_fields) ? r.type_fields : []) as FieldConfig[]} value={parseVals(r.fields_json)} mode="read" lang={lang} emptyLabel={t('dossier.noValues')} />
          </div>

          {Array.isArray(r.results) && (r.results as Record<string, unknown>[]).length ? (
            <table className="dt-table">
              <thead>
                <tr>
                  <th>{t('lab.parameter')}</th>
                  <th>{t('lab.value')}</th>
                  <th>{t('lab.range')}</th>
                  <th>{t('lab.flag')}</th>
                </tr>
              </thead>
              <tbody>
                {(r.results as Record<string, unknown>[]).map((x, i) => (
                  <tr key={i}>
                    <td>{fmtVal(x.label ?? x.key)}</td>
                    <td className="font-mono">{fmtVal(x.value)} {fmtVal(x.unit)}</td>
                    <td className="font-mono text-[11px]">{fmtVal(x.ref_low)}–{fmtVal(x.ref_high)}</td>
                    <td>{x.flag === 'H' ? <Badge tone="danger">H</Badge> : x.flag === 'L' ? <Badge tone="warn">L</Badge> : <Badge tone="ok">N</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          <div className="mt-1 flex gap-2">
            <a className="btn btn-ghost btn-sm" href={`/api/v1/documents/${encodeURIComponent(String(r.code))}/print`} target="_blank" rel="noreferrer">
              {tc('print')}
            </a>
            {(has(category, 'validate') || has('records', 'validate')) && r.status !== 'validated' ? (
              <button
                className="btn btn-ok btn-sm"
                onClick={async () => {
                  await api.post(`/records/${r.id}/validate`, {});
                }}
              >
                {t('records.validate')}
              </button>
            ) : null}
          </div>
        </div>
      )}
    />
  );
}

function parseRecord(v: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    patientId: Number(v.patientId),
    typeId: Number(v.typeId),
    actDate: v.actDate,
    status: v.status || 'draft',
    locationId: v.locationId ? Number(v.locationId) : null,
    apptId: v.apptId ? Number(v.apptId) : null,
  };
  if (v.summaryFr || v.summaryAr) out.summary = { fr: v.summaryFr as string, ar: v.summaryAr as string };
  const ids = csv(v.practitionerIdsCsv);
  if (ids.length) out.practitionerIds = ids.map(Number);
  const icd = csv(v.icd10Csv);
  if (icd.length) out.icd10 = icd;
  const att = csv(v.attachmentsCsv);
  if (att.length) out.attachments = att;
  if (v.fieldsJson) {
    try {
      out.fields = JSON.parse(String(v.fieldsJson));
    } catch {
      out.fields = {};
    }
  }
  if (v.valuesJson) {
    try {
      out.values = JSON.parse(String(v.valuesJson));
    } catch {
      out.values = [];
    }
  }
  return out;
}

function csv(v: unknown): string[] {
  return String(v ?? '')
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}
