'use client';

/**
 * ApptQuickButton — bouton « Ajouter un rendez-vous » + modale de création rapide.
 * Auto-porteur. Crée un RDV lié à un patient (requis) et, optionnellement, à un
 * dossier (caseId). Practicien/lieu facultatifs ; conflits non vérifiés ici (saisie
 * rapide depuis le dossier) — l'agenda reste la vue de référence pour les conflits.
 */
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { Dialog } from '@/components/dialogs';
import { useToast } from '@/components/toast';

/** Date/heure locale → valeur `datetime-local` (YYYY-MM-DDTHH:mm). */
function toLocalInput(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function ApptQuickButton({
  pid,
  caseId,
  onSaved,
  label,
  variant = 'primary',
}: {
  pid: number;
  caseId?: number | null;
  onSaved?: () => void;
  label?: string;
  variant?: 'primary' | 'ghost';
}): React.ReactElement {
  const { t } = useT('patient');
  const { t: tc } = useT('common');
  const toast = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(() => toLocalInput(new Date(Date.now() + 3600_000)));
  const [end, setEnd] = useState(() => toLocalInput(new Date(Date.now() + 2 * 3600_000)));
  const [kind, setKind] = useState('consultation');
  const [status, setStatus] = useState('pending');
  const [practitionerId, setPractitionerId] = useState<number | null>(null);
  const [locationId, setLocationId] = useState<number | null>(null);
  const [notes, setNotes] = useState('');

  const practs = useQuery({ queryKey: ['pract-lite'], queryFn: () => api.get<{ rows: { id: number; code: string; last_name: string; first_name: string }[] }>('/practitioners?pageSize=100&active=true'), enabled: open });
  const locs = useQuery({ queryKey: ['loc-lite'], queryFn: () => api.get<{ rows: { id: number; code: string; kind: string }[] }>('/locations?pageSize=100&active=true'), enabled: open });

  const valid = start.length >= 16 && end.length >= 16 && new Date(end) > new Date(start);

  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: number }>('/appointments', {
        patientId: pid,
        caseId: caseId ?? null,
        practitionerId,
        locationId,
        startAt: new Date(start).toISOString(),
        endAt: new Date(end).toISOString(),
        kind,
        status,
        notes: notes || null,
      }),
    onSuccess: () => {
      toast.success(tc('saved'));
      setOpen(false);
      setNotes('');
      void qc.invalidateQueries({ queryKey: ['dossier'] });
      void qc.invalidateQueries({ queryKey: ['dossiers'] });
      void qc.invalidateQueries({ queryKey: ['agenda'] });
      onSaved?.();
    },
    onError: (e: unknown) => toast.error(t(`errors.${(e as { code?: string }).code ?? 'network'}`)),
  });

  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        <CalendarPlus size={14} /> {label ?? t('appt.new')}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={label ?? t('appt.new')}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>{tc('cancel')}</Button>
            <Button variant="primary" loading={create.isPending} disabled={!valid} onClick={() => create.mutate()}>{tc('save')}</Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('appt.start')} required>
            <Input type="datetime-local" dir="ltr" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label={t('appt.end')} required>
            <Input type="datetime-local" dir="ltr" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
          <Field label={t('appt.kind')}>
            <Select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              options={[
                { value: 'consultation', label: t('appt.k.consultation') },
                { value: 'control', label: t('appt.k.control') },
                { value: 'procedure', label: t('appt.k.procedure') },
                { value: 'lab', label: t('appt.k.lab') },
                { value: 'radio', label: t('appt.k.radio') },
              ]}
            />
          </Field>
          <Field label={t('appt.statusField')}>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              options={['pending', 'confirmed', 'done', 'cancelled', 'no_show'].map((st) => ({ value: st, label: t(`appt.status.${st}`) }))}
            />
          </Field>
          <Field label={t('appt.practitioner')}>
            <Select
              value={practitionerId ?? ''}
              onChange={(e) => setPractitionerId(e.target.value ? Number(e.target.value) : null)}
              options={[{ value: '', label: '—' }, ...(practs.data?.rows ?? []).map((x) => ({ value: String(x.id), label: `${x.last_name} ${x.first_name}`.trim() || x.code }))]}
            />
          </Field>
          <Field label={t('appt.location')}>
            <Select
              value={locationId ?? ''}
              onChange={(e) => setLocationId(e.target.value ? Number(e.target.value) : null)}
              options={[{ value: '', label: '—' }, ...(locs.data?.rows ?? []).map((x) => ({ value: String(x.id), label: x.code }))]}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label={tc('notes')}>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
        </div>
      </Dialog>
    </>
  );
}
