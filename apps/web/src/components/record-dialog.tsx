'use client';

/**
 * RecordDialog — détail + édition d'une fiche (medical_records) dans une modale.
 * Lecture : type, statut, date, résumé, champs rendus en libellé→valeur (RecordFields),
 * résultats labo. Édition : statut, date, titre + champs clé→valeur (ajout/suppression),
 * enregistrés via PUT /records/:id en préservant équipe, lieu, valeurs labo et dossier.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Badge, Button, Field, Input, Select } from '@/components/ui';
import { Dialog } from '@/components/dialogs';
import { BizCode } from '@/components/biz-code';
import { useToast } from '@/components/toast';
import { useFmtDate } from '@/lib/display';
import { RecordFields, type FieldConfig } from '@/components/record-fields';

/** Valeurs de fiche : objets/tableaux JSONB inclus (même définition que record-fields). */
type Vals = Record<string, unknown>;

function asObj(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === 'string' && v) {
    try {
      const o = JSON.parse(v);
      return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}
function asArr(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v) {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function RecordDialog({
  recordId,
  open,
  onClose,
  editable = true,
  startInEdit = false,
  onSaved,
}: {
  recordId: number | null;
  open: boolean;
  onClose: () => void;
  editable?: boolean;
  /** ouvre directement en mode édition (ex. fiche par défaut venant d'être créée) */
  startInEdit?: boolean;
  onSaved?: () => void;
}): React.ReactElement | null {
  const { t } = useT('patient');
  const { t: tc, lang } = useT('common');
  const toast = useToast();
  const qc = useQueryClient();
  const fmt = useFmtDate();
  const q = useQuery({ queryKey: ['record', recordId], queryFn: () => api.get<Record<string, unknown>>(`/records/${recordId}`), enabled: open && recordId != null });

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<{ status: string; actDate: string; titleFr: string; fields: Vals }>({ status: 'draft', actDate: '', titleFr: '', fields: {} });

  const rec = q.data;
  const config = useMemo<FieldConfig[]>(() => asArr(rec?.type_fields) as FieldConfig[], [rec]);
  const summary = useMemo(() => asObj(rec?.summary_json), [rec]);
  const results = Array.isArray(rec?.results) ? (rec!.results as Record<string, unknown>[]) : [];

  // réinitialise mode + formulaire quand la fiche cible change (évite toute valeur résiduelle
  // d'une fiche précédente avant le rechargement des données)
  useEffect(() => {
    setEditing(recordId != null ? startInEdit : false);
    setForm({ status: 'draft', actDate: '', titleFr: '', fields: {} });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId]);

  // (re)charge le formulaire dès que les données arrivent ou sont rafraîchies (sans toucher au mode)
  useEffect(() => {
    if (!rec) return;
    const fields = asObj(rec.fields_json) as Vals;
    setForm({
      status: String(rec.status ?? 'draft'),
      actDate: String(rec.act_date ?? '').slice(0, 10),
      titleFr: String(summary.fr ?? rec.summary ?? ''),
      fields,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId, q.dataUpdatedAt]);

  const save = useMutation({
    mutationFn: () =>
      api.put(`/records/${recordId}`, {
        actDate: form.actDate || String(rec?.act_date ?? '').slice(0, 10),
        status: form.status,
        summary: { ...summary, fr: form.titleFr },
        fields: form.fields,
        // préserve l'équipe et le lieu (le PUT les réinitialise sinon) ; values/icd10/appt/case omis → conservés
        practitionerIds: Array.isArray(rec?.practitioner_ids) ? (rec!.practitioner_ids as number[]) : [],
        locationId: rec?.location_id != null ? Number(rec!.location_id) : null,
      }),
    onSuccess: () => {
      toast.success(tc('saved'));
      setEditing(false);
      void qc.invalidateQueries({ queryKey: ['record', recordId] });
      void qc.invalidateQueries({ queryKey: ['dossiers'] });
      void qc.invalidateQueries({ queryKey: ['dossier'] });
      void qc.invalidateQueries({ queryKey: ['pat-records'] });
      void qc.invalidateQueries({ queryKey: ['list', 'records'] });
      onSaved?.();
    },
    onError: (e: unknown) => toast.error(t(`errors.${(e as { code?: string }).code ?? 'network'}`)),
  });

  if (!open || recordId == null) return null;

  const statusTone = (s: unknown): 'ok' | 'danger' | 'warn' => (s === 'validated' ? 'ok' : s === 'cancelled' ? 'danger' : 'warn');
  const statusLabel = (s: unknown): string => {
    const k = String(s ?? '');
    if (k === 'draft') return t('records.st.draft');
    if (k === 'validated') return t('records.st.validated');
    if (k === 'cancelled') return t('records.st.cancelled');
    if (k === 'in_progress') return t('records.st.in_progress');
    if (k === 'awaiting_results' || k === 'awaiting') return t('records.st.awaiting');
    return k;
  };

  return (
    <Dialog
      wide
      open={open}
      onClose={onClose}
      title={String(rec?.type_label ?? rec?.type_name ?? t('records.type'))}
      footer={
        editing ? (
          <>
            <Button onClick={() => setEditing(false)}>{tc('cancel')}</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>{tc('save')}</Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>{tc('cancel')}</Button>
            {editable ? (
              <Button variant="primary" onClick={() => setEditing(true)}>
                <Pencil size={15} /> {tc('edit')}
              </Button>
            ) : null}
          </>
        )
      }
    >
      {q.isLoading ? (
        <div className="skeleton h-48" />
      ) : !rec ? (
        <p className="text-[13px] text-[rgb(var(--c-muted))]">{tc('notFound')}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {/* méta */}
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-[rgb(var(--c-muted))]">
            <BizCode code={String(rec.code ?? '')} copy />
            <Badge tone="info">{String(rec.category_prefix ?? '')}</Badge>
            <Badge tone={statusTone(rec.status)}>{statusLabel(rec.status)}</Badge>
            <span dir="ltr" className="tabular-nums">{rec.act_date ? fmt(String(rec.act_date), true) : ''}</span>
            {rec.patient_name ? <span>· {String(rec.patient_name)}</span> : null}
          </div>

          {editing ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={tc('title')}>
                <Input value={form.titleFr} onChange={(e) => setForm((f) => ({ ...f, titleFr: e.target.value }))} />
              </Field>
              <Field label={tc('date')}>
                <Input type="date" dir="ltr" value={form.actDate} onChange={(e) => setForm((f) => ({ ...f, actDate: e.target.value }))} />
              </Field>
              <Field label={t('records.status')}>
                <Select
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                  options={[
                    { value: 'draft', label: t('records.st.draft') },
                    { value: 'in_progress', label: t('records.st.in_progress') },
                    { value: 'validated', label: t('records.st.validated') },
                    { value: 'cancelled', label: t('records.st.cancelled') },
                  ]}
                />
              </Field>
            </div>
          ) : (
            <>
              {(() => {
                const s = (rec?.summary_json && typeof rec.summary_json === 'object' ? (rec.summary_json as Record<string, string>)[lang] : null) || (typeof rec?.summary === 'string' ? rec.summary : null) || summary[lang] || summary.fr;
                if (!s) return null;
                return (
                  <div className="rounded-xl bg-[rgb(var(--c-surface-2))] p-3 text-[13px]" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                    <div className="font-semibold">{String(s)}</div>
                  </div>
                );
              })()}
            </>
          )}

          {/* champs clé → valeur (jamais de JSON brut) */}
          <section className="flex flex-col gap-2">
            <h4 className="text-[12.5px] font-bold text-[rgb(var(--c-muted))]">{t('records.fields')}</h4>
            {editing ? (
              <RecordFields key={`edit-${recordId}`} config={config} value={form.fields} onChange={(v) => setForm((f) => ({ ...f, fields: v }))} mode="edit" lang={lang} />
            ) : (
              <RecordFields config={config} value={asObj(rec.fields_json) as Vals} mode="read" lang={lang} emptyLabel={t('dossier.noValues')} />
            )}
          </section>

          {/* résultats labo */}
          {results.length ? (
            <section className="flex flex-col gap-2">
              <h4 className="text-[12.5px] font-bold text-[rgb(var(--c-muted))]">{t('lab.results')}</h4>
              <table className="dt-table">
                <thead>
                  <tr><th>{t('lab.parameter')}</th><th>{t('lab.value')}</th><th>{t('lab.range')}</th><th>{t('lab.flag')}</th></tr>
                </thead>
                <tbody>
                  {results.map((x, i) => (
                    <tr key={i}>
                      <td>{String(x.label ?? x.key ?? '')}</td>
                      <td className="font-mono">{String(x.value ?? '')} {String(x.unit ?? '')}</td>
                      <td className="font-mono text-[11px]">{String(x.ref ?? '')}</td>
                      <td>{x.flag === 'H' ? <Badge tone="danger">H</Badge> : x.flag === 'L' ? <Badge tone="warn">L</Badge> : <Badge tone="ok">N</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
