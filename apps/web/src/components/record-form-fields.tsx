'use client';

/**
 * Composants de sélection spécialisés pour le formulaire d'édition/création de fiches médicales :
 * 1. PatientAutocompletePicker : sélection interactive avec recherche instantanée (nom, prénom, code, téléphone, NSS).
 * 2. ApptPicker : sélection d'un rendez-vous parmi ceux du patient (code, date, heure, type) + modale rapide d'ajout de RDV.
 * 3. LocationPicker : sélection avec autocomplétion parmi les lieux actifs + sous-modale de création immédiate de lieu.
 */
import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarPlus, MapPin, Plus, Search, User, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { pickLabel } from '@sardpi/shared';
import { Button, Input, Select, Badge } from '@/components/ui';
import { BizCode } from '@/components/biz-code';
import { ApptQuickDialog } from '@/components/appt-quick-dialog';
import { LocationQuickDialog } from '@/components/location-quick-dialog';

export interface PatientLite {
  id: number;
  code: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  birth_date?: string;
  phone?: string;
  ss_number?: string;
}

export function PatientAutocompletePicker({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (id: string, pat?: PatientLite) => void;
}): React.ReactElement {
  const { t } = useT('patient');
  const { t: tc } = useT('common');
  const [q, setQ] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const patientsQuery = useQuery({
    queryKey: ['pat-lite-list'],
    queryFn: () =>
      api.get<{ rows: PatientLite[] }>('/patients', {
        pageSize: 100,
      }),
  });

  const rows = patientsQuery.data?.rows ?? [];
  const selectedId = value ? Number(value) : null;
  const currentPat = useMemo(() => rows.find((p) => p.id === selectedId) ?? null, [rows, selectedId]);

  const filtered = useMemo(() => {
    if (!q.trim()) return rows.slice(0, 8);
    const s = q.trim().toLowerCase();
    return rows.filter((p) => {
      const nom = `${p.last_name ?? ''} ${p.first_name ?? ''} ${p.full_name ?? ''}`.toLowerCase();
      const code = String(p.code ?? '').toLowerCase();
      const tel = String(p.phone ?? '').toLowerCase();
      const ss = String(p.ss_number ?? '').toLowerCase();
      return nom.includes(s) || code.includes(s) || tel.includes(s) || ss.includes(s);
    }).slice(0, 10);
  }, [rows, q]);

  if (currentPat) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-[rgb(var(--c-line)/0.8)] bg-[rgb(var(--c-surface-2))] p-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[rgb(var(--c-primary)/0.12)] text-[rgb(var(--c-primary))]">
            <User size={16} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-semibold text-[13px]">
                {currentPat.last_name ? `${currentPat.last_name.toUpperCase()} ${currentPat.first_name ?? ''}` : currentPat.full_name}
              </span>
              <BizCode code={currentPat.code} />
            </div>
            {currentPat.birth_date ? (
              <span className="text-[11.5px] text-[rgb(var(--c-muted))]">
                {String(currentPat.birth_date).slice(0, 10)} {currentPat.phone ? `· ${currentPat.phone}` : ''}
              </span>
            ) : null}
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            onChange('');
            setQ('');
            setIsOpen(true);
          }}
          title={tc('cancel')}
        >
          <X size={14} />
        </Button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder={t('list.searchPlaceholder')}
        />
        <Search size={15} className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-[rgb(var(--c-muted))]" />
      </div>

      {isOpen && (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-[rgb(var(--c-line))] bg-[rgb(var(--c-surface))] p-1 shadow-lg backdrop-blur-md">
          {filtered.length === 0 ? (
            <div className="p-3 text-center text-[12px] text-[rgb(var(--c-muted))]">
              {tc('list.emptyHint')}
            </div>
          ) : (
            filtered.map((pat) => (
              <button
                key={pat.id}
                type="button"
                className="flex w-full items-center justify-between gap-2 rounded-lg p-2 text-start transition hover:bg-[rgb(var(--c-primary-soft)/0.5)]"
                onClick={() => {
                  onChange(String(pat.id), pat);
                  setIsOpen(false);
                  setQ('');
                }}
              >
                <div className="min-w-0">
                  <div className="truncate font-semibold text-[12.5px]">
                    {pat.last_name ? `${pat.last_name.toUpperCase()} ${pat.first_name ?? ''}` : pat.full_name}
                  </div>
                  <div className="text-[11px] text-[rgb(var(--c-muted))]">
                    {pat.birth_date ? String(pat.birth_date).slice(0, 10) : ''} {pat.phone ? `· ${pat.phone}` : ''}
                  </div>
                </div>
                <BizCode code={pat.code} />
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function ApptPicker({
  patientId,
  value,
  onChange,
}: {
  patientId: unknown;
  value: unknown;
  onChange: (id: string) => void;
}): React.ReactElement {
  const { t } = useT('patient');
  const [openNew, setOpenNew] = useState(false);

  const pid = patientId ? Number(patientId) : null;

  const apptsQuery = useQuery({
    queryKey: ['patient-appts', pid],
    queryFn: () =>
      api.get<{ rows: { id: number; code?: string; start_at: string; end_at?: string; kind?: string; status?: string }[] }>('/appointments', {
        pageSize: 100,
      }),
    enabled: pid != null,
  });

  const appts = useMemo(() => {
    if (!pid || !apptsQuery.data?.rows) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return apptsQuery.data.rows.filter((a: any) => Number(a.patient_id) === pid);
  }, [pid, apptsQuery.data]);

  const selectedVal = value ? String(value) : '';

  const fmtApptLabel = (a: { id: number; code?: string; start_at: string; kind?: string; status?: string }) => {
    const d = new Date(a.start_at);
    const dateStr = !Number.isNaN(d.getTime())
      ? `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
      : a.start_at;
    const code = a.code ? `[${a.code}] ` : '';
    const kind = a.kind ? ` — ${t(`appt.k.${a.kind}`) || a.kind}` : '';
    const st = a.status ? ` (${a.status})` : '';
    return `${code}${dateStr}${kind}${st}`;
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          {!pid ? (
            <Input disabled value="" placeholder="Sélectionnez d'abord un patient…" />
          ) : (
            <Select
              value={selectedVal}
              onChange={(e) => onChange(e.target.value)}
              options={[
                { value: '', label: '— Aucun rendez-vous lié —' },
                ...appts.map((a) => ({
                  value: String(a.id),
                  label: fmtApptLabel(a),
                })),
              ]}
            />
          )}
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!pid}
          onClick={() => setOpenNew(true)}
          title={t('appt.new')}
          className="shrink-0"
        >
          <CalendarPlus size={15} />
          <span className="hidden sm:inline">{t('appt.new')}</span>
        </Button>
      </div>

      <ApptQuickDialog
        pid={pid}
        open={openNew}
        onClose={() => setOpenNew(false)}
        onSaved={(newAppt) => {
          void apptsQuery.refetch();
          onChange(String(newAppt.id));
        }}
      />
    </div>
  );
}

export function LocationPicker({
  value,
  onChange,
  lang,
}: {
  value: unknown;
  onChange: (id: string) => void;
  lang: string;
}): React.ReactElement {
  const { t } = useT('patient');
  const [openNew, setOpenNew] = useState(false);

  const locsQuery = useQuery({
    queryKey: ['locations-lite-active'],
    queryFn: () =>
      api.get<{ rows: { id: number; code: string; kind: string; name?: string; name_json?: Record<string, string>; building?: string; active: number }[] }>('/locations', {
        pageSize: 100,
      }),
  });

  const locs = locsQuery.data?.rows ?? [];
  const selectedVal = value ? String(value) : '';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Select
            value={selectedVal}
            onChange={(e) => onChange(e.target.value)}
            options={[
              { value: '', label: '— Aucun lieu sélectionné —' },
              ...locs.map((l) => {
                const name = pickLabel(l.name_json ?? {}, lang) || l.name || l.building || l.code;
                const kind = t(`loc.k.${l.kind}`) || l.kind;
                return {
                  value: String(l.id),
                  label: `${l.code} — ${name} (${kind})`,
                };
              }),
            ]}
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setOpenNew(true)}
          title={t('loc.new')}
          className="shrink-0"
        >
          <Plus size={15} />
          <span className="hidden sm:inline">{t('loc.new')}</span>
        </Button>
      </div>

      <LocationQuickDialog
        open={openNew}
        onClose={() => setOpenNew(false)}
        onSaved={(newLoc) => {
          void locsQuery.refetch();
          onChange(String(newLoc.id));
        }}
      />
    </div>
  );
}
