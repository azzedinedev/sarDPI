'use client';
/**
 * MODULE « DOSES DE VACCINATION » — liste/CRUD partagé entre le dossier patient (onglet Vaccination)
 * et Administration » Vaccination (tous les carnets).
 * ------------------------------------------------------------------------------------------------
 * Un seul point de configuration pour les deux écrans : mêmes colonnes, mêmes libellés, même
 * validation. La différence tient au scope — `pid` fixe le patient (le champ « patient » disparaît du
 * formulaire et l'API est filtrée par `?patientId=`), son absence ouvre la vue transversale avec un
 * sélecteur de patient à distance (recherche serveur, jamais la liste entière en mémoire).
 *
 * Les libellés de vaccins viennent du calendrier administrable (`/vaccinations/calendar`) : une dose
 * saisie aujourd'hui affiche le nom décidé par l'administrateur, pas une clé technique.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Syringe, User } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useFmtDate } from '@/lib/display';
import { Badge, Button } from '@/components/ui';
import { BizCode } from '@/components/biz-code';
import { CrudModule, fmtVal } from '@/components/crud';
import { AsyncAutocomplete, type ComboOption } from '@/components/combo';
import { useToast } from '@/components/toast';
import { useAuth } from '@/stores/auth';
import { useVaccinationCalendar, vaccineOptions } from '@/components/vaccination-card';
import type { FieldDef, ColDef } from '@/components/crud/types';

interface PatientRow {
  id: number;
  code: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  birth_date?: string;
}

/** Sélecteur de patient à distance (recherche serveur) — utilisé en vue transversale uniquement. */
function PatientPicker({ value, label, onChange }: { value: unknown; label?: string | null; onChange: (id: number | null) => void }): React.ReactElement {
  const { t } = useT('patient');
  const [sel, setSel] = useState<ComboOption | null>(value ? { value: String(value), label: label ?? `#${String(value)}` } : null);

  // valeur imposée (édition d'une ligne existante) : la pastille suit la valeur du formulaire
  useEffect(() => {
    setSel(value ? { value: String(value), label: label ?? `#${String(value)}` } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const fetchOptions = useCallback(async (q: string): Promise<ComboOption[]> => {
    const res = await api.get<{ rows: PatientRow[] }>('/patients', { q, pageSize: 20 });
    return (res.rows ?? []).map((p) => ({
      value: String(p.id),
      label: `${fmtVal(p.last_name ?? '').toUpperCase()} ${fmtVal(p.first_name ?? '')}`.trim() || fmtVal(p.full_name ?? `#${p.id}`),
      sublabel: fmtVal(p.code ?? ''),
    }));
  }, []);

  return (
    <AsyncAutocomplete
      value={sel}
      fetchOptions={fetchOptions}
      minChars={2}
      placeholder={t('vax.patient.search')}
      onChange={(o) => {
        setSel(o);
        onChange(o ? Number(o.value) : null);
      }}
    />
  );
}

export function VaccinationDosesModule({
  pid,
  title,
  subtitle,
  toolbarExtra,
  createLabel,
  onSaved,
  rowHrefToPatient,
}: {
  /** scope patient (dossier) — absent = vue transversale de tous les carnets */
  pid?: number;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  toolbarExtra?: React.ReactNode;
  createLabel?: string;
  /** appelé après chaque écriture : le carnet (couverture) est recalculé côté serveur */
  onSaved?: () => void;
  /** vue transversale : un clic sur la ligne ouvre le dossier patient correspondant */
  rowHrefToPatient?: boolean;
}): React.ReactElement {
  const { t } = useT('patient');
  const { t: tc } = useT('common');
  const fmt = useFmtDate();
  const has = useAuth((s) => s.has);
  const calendar = useVaccinationCalendar();

  const practitioners = useQuery({
    queryKey: ['practitioners-lite'],
    queryFn: () => api.get<{ rows: { id: number; code?: string; first_name?: string; last_name?: string }[] }>('/practitioners', { pageSize: 100 }),
    staleTime: 120_000,
  });
  const locations = useQuery({
    queryKey: ['locations-lite'],
    queryFn: () => api.get<{ rows: { id: number; code?: string; name?: string; name_json?: Record<string, string> }[] }>('/locations', { pageSize: 100 }),
    staleTime: 120_000,
  });

  const pracOptions = useMemo(
    () => (practitioners.data?.rows ?? []).map((p) => ({ value: String(p.id), label: `${fmtVal(p.last_name ?? '')} ${fmtVal(p.first_name ?? '')}`.trim() || fmtVal(p.code ?? `#${p.id}`) })),
    [practitioners.data],
  );
  const locOptions = useMemo(
    () => (locations.data?.rows ?? []).map((l) => ({ value: String(l.id), label: `${fmtVal(l.code ?? '')} — ${fmtVal(l.name ?? '')}`.trim() })),
    [locations.data],
  );
  const vaxOptions = useMemo(() => vaccineOptions(calendar.entries), [calendar.entries]);

  const columns = useMemo<ColDef[]>(() => {
    const cols: ColDef[] = [
      { key: 'code', label: tc('code'), width: '120px', render: (r) => <BizCode code={r.code as string} copy /> },
    ];
    if (!pid) {
      cols.push({
        key: 'patient_id',
        label: t('vax.patient'),
        render: (r) => (
          <span className="flex min-w-0 items-center gap-1.5">
            <User size={12} className="shrink-0 text-[rgb(var(--c-muted))]" />
            <span className="truncate font-semibold">{fmtVal(r.patient_name ?? `#${fmtVal(r.patient_id)}`)}</span>
            {r.patient_code ? <BizCode code={r.patient_code as string} /> : null}
          </span>
        ),
      });
    }
    cols.push(
      {
        key: 'vaccine_key',
        label: t('vax.vaccine'),
        render: (r) => (
          <span className="flex min-w-0 items-center gap-1.5">
            <Syringe size={12} className="shrink-0 text-[rgb(var(--c-primary))]" />
            <span className="truncate font-semibold">{fmtVal(r.vaccine_label ?? r.vaccine_key)}</span>
            {Number(r.vaccine_mandatory) === 1 || r.vaccine_mandatory === true ? <Badge tone="warn">{t('vax.mandatory')}</Badge> : null}
          </span>
        ),
      },
      { key: 'dose_no', label: t('vax.dose'), width: '70px', align: 'center', render: (r) => <span className="font-mono tabular-nums">{fmtVal(r.dose_no)}</span> },
      {
        key: 'status',
        label: t('vax.status'),
        width: '120px',
        render: (r) => {
          const s = String(r.status ?? 'planned');
          return <Badge tone={s === 'done' ? 'ok' : s === 'planned' ? 'info' : s === 'refused' ? 'danger' : 'warn'}>{t(`vax.status.${s}`)}</Badge>;
        },
      },
      { key: 'administered_at', label: t('vax.administeredAt'), width: '110px', sortable: true, render: (r) => (r.administered_at ? <span dir="ltr" className="tabular-nums text-[12px]">{fmt(r.administered_at, true)}</span> : <span className="text-[rgb(var(--c-muted))]">—</span>) },
      { key: 'due_at', label: t('vax.dueAt'), width: '110px', sortable: true, render: (r) => (r.due_at ? <span dir="ltr" className="tabular-nums text-[12px]">{fmt(r.due_at, true)}</span> : <span className="text-[rgb(var(--c-muted))]">—</span>) },
      { key: 'practitioner_name', label: t('vax.practitioner'), render: (r) => fmtVal(r.practitioner_name ?? '—') },
      { key: 'location_label', label: t('vax.location'), hideByDefault: true, render: (r) => fmtVal(r.location_label ?? '—') },
      { key: 'batch', label: t('vax.batch'), width: '110px', hideByDefault: true, render: (r) => <span className="font-mono text-[11.5px]">{fmtVal(r.batch ?? '—')}</span> },
      { key: 'site', label: t('vax.site'), hideByDefault: true },
    );
    return cols;
  }, [pid, t, tc, fmt]);

  const fields = useMemo<FieldDef[]>(() => {
    const out: FieldDef[] = [];
    if (!pid) {
      out.push({
        key: 'patientId',
        label: t('vax.patient'),
        required: true,
        hint: t('vax.patient.hint'),
        render: (v, row) => fmtVal(row?.patient_name ?? `#${String(v ?? '')}`),
        renderInput: ({ value, setValue, row }) => (
          <PatientPicker
            value={value}
            label={row?.patient_name ? String(row.patient_name) : null}
            onChange={(id) => setValue(id ?? '')}
          />
        ),
      });
    }
    out.push(
      { key: 'vaccineKey', label: t('vax.vaccine'), kind: 'autocomplete', options: vaxOptions, required: true, hint: t('vax.vaccine.hint') },
      { key: 'doseNo', label: t('vax.dose'), kind: 'number', min: 1, max: 10, step: 1, required: true, hint: t('vax.dose.hint') },
      {
        key: 'status',
        label: t('vax.status'),
        kind: 'select',
        required: true,
        options: [
          { value: 'done', label: t('vax.status.done') },
          { value: 'planned', label: t('vax.status.planned') },
          { value: 'refused', label: t('vax.status.refused') },
          { value: 'missed', label: t('vax.status.missed') },
        ],
      },
      { key: 'administeredAt', label: t('vax.administeredAt'), kind: 'date', hint: t('vax.administeredAt.hint') },
      { key: 'dueAt', label: t('vax.dueAt'), kind: 'date', hint: t('vax.dueAt.hint') },
      { key: 'site', label: t('vax.site'), placeholder: 'Deltoïde gauche' },
      { key: 'batch', label: t('vax.batch'), placeholder: 'LOT-2026-0148' },
      { key: 'practitionerId', label: t('vax.practitioner'), kind: 'autocomplete', options: pracOptions },
      { key: 'locationId', label: t('vax.location'), kind: 'autocomplete', options: locOptions },
      { key: 'notes', label: tc('notes'), kind: 'textarea', colSpan: 2 },
    );
    return out;
  }, [pid, t, tc, vaxOptions, pracOptions, locOptions]);

  const num = (v: unknown): number | null => (v === '' || v === null || v === undefined ? null : Number(v));

  return (
    <CrudModule
      resource="vaccinations"
      title={title ?? t('vax.title')}
      subtitle={subtitle}
      search
      scopeSelect
      canExport={has('vaccination', 'export')}
      defaultSort={{ id: 'id', desc: true }}
      columns={columns}
      fields={fields}
      cardTitle={(r) => `${fmtVal(r.vaccine_label ?? r.vaccine_key)} — ${t('vax.dose')} ${fmtVal(r.dose_no)}`}
      cardSubtitle={(r) => <BizCode code={r.code as string} />}
      cardBadges={(r) => <Badge tone={String(r.status) === 'done' ? 'ok' : 'info'}>{t(`vax.status.${String(r.status ?? 'planned')}`)}</Badge>}
      extraQuery={pid ? { patientId: pid } : undefined}
      canCreate={has('vaccination', 'create')}
      canUpdate={has('vaccination', 'update')}
      canDelete={has('vaccination', 'delete')}
      canArchive={has('vaccination', 'archive')}
      createLabel={createLabel ?? t('vax.new')}
      toolbarExtra={toolbarExtra}
      // `patientId` imposé par le scope (dossier patient) ou choisi dans le sélecteur (vue admin) ;
      // les identifiants vides deviennent null (colonnes nullable) — jamais '' en base.
      transformCreate={(v) => ({
        ...v,
        patientId: pid ?? num(v.patientId) ?? undefined,
        doseNo: Number(v.doseNo ?? 1),
        practitionerId: num(v.practitionerId),
        locationId: num(v.locationId),
        administeredAt: v.administeredAt || null,
        dueAt: v.dueAt || null,
      })}
      onSaved={onSaved}
      rowHref={rowHrefToPatient && !pid ? (r) => `/patients/${Number(r.patient_id)}` : undefined}
      transformUpdate={(v) => ({ ...v, doseNo: v.doseNo === undefined || v.doseNo === '' ? undefined : Number(v.doseNo), practitionerId: num(v.practitionerId), locationId: num(v.locationId), administeredAt: v.administeredAt || null, dueAt: v.dueAt || null })}
    />
  );
}

/**
 * Bouton « Générer le calendrier » — matérialise les doses manquantes du calendrier vaccinal pour un
 * patient (statut « planifiée », échéance calculée depuis la date de naissance). Idempotent : le
 * serveur ignore les doses déjà présentes, aucune saisie existante n'est modifiée.
 */
export function GeneratePlanButton({ pid, onDone }: { pid: number; onDone?: () => void }): React.ReactElement | null {
  const { t } = useT('patient');
  const { t: te } = useT('errors');
  const toast = useToast();
  const qc = useQueryClient();
  const has = useAuth((s) => s.has);
  const mut = useMutation({
    mutationFn: () => api.post<{ created: number; skipped: number; plan: number }>(`/patients/${pid}/vaccination/generate`, {}),
    onSuccess: (res) => {
      if (res.created > 0) toast.success(t('vax.generate.done', { count: res.created }));
      else toast.info(t('vax.generate.none'));
      void qc.invalidateQueries({ queryKey: ['list', 'vaccinations'] });
      void qc.invalidateQueries({ queryKey: ['vaccination-carnet', pid] });
      void qc.invalidateQueries({ queryKey: ['history', pid] });
      onDone?.();
    },
    onError: (e: unknown) => {
      // le serveur renvoie un CODE traduit (« errors.vaccinationCalendarEmpty », « errors.forbidden »…)
      const code = String((e as { code?: string })?.code ?? '');
      toast.error(code.startsWith('errors.') ? te(code) : t('vax.generate.error'));
    },
  });
  if (!has('vaccination', 'create')) return null;
  return (
    <Button size="sm" variant="ghost" loading={mut.isPending} onClick={() => mut.mutate()} title={t('vax.generate.hint')}>
      <CalendarPlus size={14} /> {t('vax.generate')}
    </Button>
  );
}
