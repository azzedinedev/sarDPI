'use client';
/**
 * Calendrier — vue semaine (7 colonnes, heures 07→19), weekend du pays surligné (ven/sam pour DZ),
 * RTL complet (axes inversés), création par clic sur un créneau, changement d'état en un clic,
 * conflit signalé (vérification serveur /appointments/conflicts).
 */
import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { AlertTriangle, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Badge, Button, Field, Select, Textarea } from '@/components/ui';
import { Dialog } from '@/components/dialogs';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/utils';
import { workingDays } from '@/lib/format';
import { useAuth } from '@/stores/auth';

interface Appt {
  id: number;
  code: string | null;
  patient_id?: number;
  patient_name: string | null;
  start_at: string;
  end_at: string;
  kind: string;
  status: string;
  location_name?: string | null;
  practitioner_name?: string | null;
}

const HOUR0 = 7;
const HOUR1 = 19;
const SLOT_MIN = 30;
const PX_PER_SLOT = 26;

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // lundi = 0
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

export default function CalendarPage(): React.ReactElement {
  const { t } = useT('patient');
  const { t: tc } = useT('common');
  const toast = useToast();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const has = useAuth((s) => s.has);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [create, setCreate] = useState<{ start: string } | null>(null);
  const canWrite = has('calendar', 'create');

  const from = weekStart.toISOString();
  const to = new Date(weekStart.getTime() + 7 * 86_400_000).toISOString();
  const q = useQuery({ queryKey: ['agenda', from, to], queryFn: () => api.get<{ rows: Appt[] }>(`/appointments/view?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`), refetchInterval: 60_000 });
  const rows = q.data?.rows ?? [];

  const grid = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * 86_400_000));
    const slots = (HOUR1 - HOUR0) * (60 / SLOT_MIN);
    const byDay = days.map(() => Array.from({ length: slots }, () => [] as Appt[]));
    for (const a of rows) {
      const d = new Date(a.start_at);
      const di = days.findIndex((x) => x.toDateString() === d.toDateString());
      if (di < 0) continue;
      const mins = d.getHours() * 60 + d.getMinutes() - HOUR0 * 60;
      if (mins < 0 || mins >= slots * SLOT_MIN) continue;
      byDay[di]![Math.floor(mins / SLOT_MIN)]!.push(a);
    }
    return { days, byDay, slots };
  }, [rows, weekStart]);

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => api.post(`/appointments/${id}/status`, { status }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['agenda'] });
    },
  });

  const dayNames = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(tc('lang.code') === 'ar' ? 'ar' : 'fr', { weekday: 'short' });
    return grid.days.map((d) => fmt.format(d));
  }, [grid.days, tc]);
  const wd = workingDays();

  return (
    <div className="flex flex-col gap-3">
      <div className="glass-card flex flex-wrap items-center gap-2 !p-2">
        <h1 className="px-2 text-[17px] font-bold">{t('cal.title')}</h1>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => setWeekStart((w) => new Date(w.getTime() - 7 * 86_400_000))} aria-label="←">
            <ChevronLeft size={15} className="rtl:rotate-180" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setWeekStart(startOfWeek(new Date()))}>
            {t('cal.today')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setWeekStart((w) => new Date(w.getTime() + 7 * 86_400_000))} aria-label="→">
            <ChevronRight size={15} className="rtl:rotate-180" />
          </Button>
        </div>
        <span className="font-mono text-[12px] text-[rgb(var(--c-muted))]">
          {grid.days[0]!.toLocaleDateString()} → {grid.days[6]!.toLocaleDateString()}
        </span>
        {canWrite ? (
          <Button size="sm" variant="primary" className="ms-auto" onClick={() => setCreate({ start: new Date(weekStart.getTime() + 9 * 3600_000).toISOString().slice(0, 16) })}>
            <Plus size={14} /> {t('appt.new')}
          </Button>
        ) : null}
      </div>

      <div className="glass-card overflow-x-auto !p-0">
        <div className="min-w-[860px]">
          {/* entête jours */}
          <div className="grid border-b border-[rgb(var(--c-line))] [grid-template-columns:64px_repeat(7,1fr)]">
            <div />
            {grid.days.map((d, i) => {
              const isToday = d.toDateString() === new Date().toDateString();
              const off = !wd.includes(d.getDay());
              return (
                <div key={i} className={cn('px-2 py-2 text-center', off && 'bg-[rgb(var(--c-surface-2)/0.8)]', isToday && 'bg-[rgb(var(--c-primary-soft)/0.8)]')}>
                  <div className={cn('text-[12px] font-bold', isToday && 'text-[rgb(var(--c-primary))]')}>{dayNames[i]}</div>
                  <div className="font-mono text-[15px]">{d.getDate()}</div>
                </div>
              );
            })}
          </div>
          {/* grille */}
          <div className="grid [grid-template-columns:64px_repeat(7,1fr)]">
            <div className="flex flex-col">
              {Array.from({ length: (HOUR1 - HOUR0) * 2 }, (_, s) => (
                <div key={s} className="flex h-[26px] items-start justify-end pe-1 font-mono text-[9.5px] text-[rgb(var(--c-muted))]" style={{ height: PX_PER_SLOT }}>
                  {s % 2 === 0 ? `${HOUR0 + s / 2}:00` : ''}
                </div>
              ))}
            </div>
            {grid.days.map((d, di) => (
              <div key={di} className={cn('relative border-s border-[rgb(var(--c-line)/0.6)]', !wd.includes(d.getDay()) && 'bg-[rgb(var(--c-surface-2)/0.45)]')} style={{ height: grid.slots * PX_PER_SLOT }}>
                {Array.from({ length: grid.slots }, (_, s) => (
                  <div
                    key={s}
                    className={cn('absolute inset-x-0 cursor-pointer border-t transition-colors', s % 2 === 0 ? 'border-[rgb(var(--c-line)/0.55)]' : 'border-[rgb(var(--c-line)/0.2)]', 'hover:bg-[rgb(var(--c-primary)/0.06)]')}
                    style={{ top: s * PX_PER_SLOT, height: PX_PER_SLOT }}
                    onClick={() => {
                      if (!canWrite) return;
                      const dt = new Date(d);
                      dt.setHours(HOUR0 + Math.floor(s / 2), (s % 2) * 30, 0, 0);
                      setCreate({ start: toLocalInput(dt) });
                    }}
                  />
                ))}
                {grid.byDay[di]!.map((cell, s) =>
                  cell.map((a) => (
                    <motion.div
                      key={a.id}
                      initial={{ opacity: 0, scale: 0.96 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className={cn(
                        'absolute inset-x-0.5 z-10 overflow-hidden rounded-lg border px-1.5 py-1 text-[10.5px] font-semibold shadow-sm',
                        a.status === 'done' && 'opacity-55',
                        a.status === 'cancelled' && 'opacity-30 line-through',
                        statusColor(a.status),
                      )}
                      style={{ top: s * PX_PER_SLOT + 1, height: PX_PER_SLOT * 1.5 }}
                      title={`${a.patient_name ?? ''} — ${a.kind}`}
                    >
                      <button className="block w-full truncate text-start" onClick={() => (window.location.href = `/patients/${a.patient_id}`)}>
                        {new Date(a.start_at).toTimeString().slice(0, 5)} {a.patient_name ?? t('appt.orphan')}
                      </button>
                      <div className="flex items-center gap-1 text-[9px] opacity-80">
                        <span className="truncate">{a.kind}</span>
                        {has('calendar', 'update') ? (
                          <select
                            className="ms-auto w-16 rounded border-0 bg-transparent text-[9px] font-bold outline-none"
                            value={a.status}
                            onChange={(e) => setStatus.mutate({ id: a.id, status: e.target.value })}
                          >
                            {['pending', 'confirmed', 'done', 'cancelled', 'no_show'].map((st) => (
                              <option key={st} value={st}>
                                {t(`appt.status.${st}`)}
                              </option>
                            ))}
                          </select>
                        ) : null}
                      </div>
                    </motion.div>
                  )),
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <CreateAppt
        open={Boolean(create)}
        initial={create?.start ?? ''}
        onClose={() => setCreate(null)}
        onCreated={() => {
          setCreate(null);
          void qc.invalidateQueries({ queryKey: ['agenda'] });
          toast.success(tc('saved'));
        }}
        patientHint={sp.get('patient') ? Number(sp.get('patient')) : undefined}
      />
    </div>
  );
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function statusColor(status: string): string {
  switch (status) {
    case 'confirmed':
      return 'border-[rgb(var(--c-ok)/0.5)] bg-[rgb(var(--c-ok-soft))]';
    case 'done':
      return 'border-[rgb(var(--c-info)/0.4)] bg-[rgb(var(--c-info-soft))]';
    case 'cancelled':
      return 'border-[rgb(var(--c-coral)/0.4)] bg-[rgb(var(--c-coral-soft))]';
    case 'no_show':
      return 'border-[rgb(var(--c-muted)/0.4)] bg-[rgb(var(--c-surface-2))]';
    default:
      return 'border-[rgb(var(--c-amber)/0.5)] bg-[rgb(var(--c-amber-soft))]';
  }
}

function CreateAppt({ open, initial, onClose, onCreated, patientHint }: { open: boolean; initial: string; onClose: () => void; onCreated: () => void; patientHint?: number }): React.ReactElement {
  const { t } = useT('patient');
  const { t: tc } = useT('common');
  const [patientQ, setPatientQ] = useState(patientHint ? `#${patientHint}` : '');
  const [patientId, setPatientId] = useState<number | null>(patientHint ?? null);
  const [start, setStart] = useState(initial);
  const [dur, setDur] = useState('30');
  const [kind, setKind] = useState('consultation');
  const [notes, setNotes] = useState('');
  const [conflict, setConflict] = useState<string | null>(null);
  const [practitionerId, setPract] = useState<number | null>(null);
  const [locationId, setLoc] = useState<number | null>(null);
  const practs = useQuery({ queryKey: ['pract-lite'], queryFn: () => api.get<{ rows: { id: number; code: string; last_name: string; first_name: string }[] }>('/practitioners?pageSize=100&active=true'), enabled: open });
  const locs = useQuery({ queryKey: ['loc-lite'], queryFn: () => api.get<{ rows: { id: number; code: string; kind: string }[] }>('/locations?pageSize=100&active=true'), enabled: open });
  const search = useQuery({ queryKey: ['pat-search', patientQ], queryFn: () => api.get<{ rows: { id: number; code: string; full_name: string }[] }>(`/patients/search?q=${encodeURIComponent(patientQ)}`), enabled: open && patientQ.length >= 2 });
  const mut = useMutation({
    mutationFn: async () => {
      const st = new Date(start);
      const en = new Date(st.getTime() + Number(dur) * 60_000);
      if (practitionerId || locationId) {
        // pré-check serveur (verrou anti-conflit) pour le praticien / la salle choisis
        const c = await api.post<{ conflicts: { code: string }[] }>('/appointments/conflicts', {
          practitionerId: practitionerId ?? null,
          locationId: locationId ?? null,
          startAt: st.toISOString(),
          endAt: en.toISOString(),
        });
        if (c.conflicts.length) throw new Error(`conflict:${c.conflicts[0]!.code}`);
      }
      return api.post('/appointments', { patientId, practitionerId: practitionerId ?? null, locationId: locationId ?? null, startAt: st.toISOString(), endAt: en.toISOString(), kind, notes: notes || undefined });
    },
    onSuccess: onCreated,
    onError: (e: Error) => (e.message.startsWith('conflict:') ? setConflict(e.message.slice(9)) : setConflict('!')),
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('appt.new')}
      footer={
        <>
          <Button onClick={onClose}>{tc('cancel')}</Button>
          <Button variant="primary" disabled={!patientId || !start} loading={mut.isPending} onClick={() => mut.mutate()}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('appt.patient')} required>
          <input className="field" value={patientQ} onChange={(e) => { setPatientQ(e.target.value); setPatientId(null); }} placeholder={t('list.searchPlaceholder')} />
          {patientId ? <p className="mt-1 text-[12px] font-bold text-[rgb(var(--c-ok))]">#{patientId} ✓</p> : null}
          {patientQ.length >= 2 && !patientId ? (
            <div className="mt-1 max-h-40 overflow-y-auto rounded-xl border border-[rgb(var(--c-line))]">
              {(search.data?.rows ?? []).map((p) => (
                <button
                  key={p.id}
                  className="flex w-full items-center justify-between px-2.5 py-2 text-start text-[13px] hover:bg-[rgb(var(--c-surface-2))]"
                  onClick={() => {
                    setPatientId(p.id);
                    setPatientQ(`${p.full_name} (${p.code})`);
                  }}
                >
                  <span>{p.full_name}</span>
                  <span dir="ltr" className="font-mono text-[11px]">{p.code}</span>
                </button>
              ))}
            </div>
          ) : null}
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('appt.start')}>
            <input type="datetime-local" className="field" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label={t('appt.duration')}>
            <Select value={dur} onChange={(e) => setDur(e.target.value)} options={['15', '30', '45', '60', '90', '120'].map((x) => ({ value: x, label: `${x} min` }))} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('appt.practitioner')}>
            <Select value={practitionerId ?? ''} onChange={(e) => setPract(e.target.value ? Number(e.target.value) : null)} options={[{ value: '', label: '—' }, ...(practs.data?.rows ?? []).map((x) => ({ value: String(x.id), label: `${x.last_name} ${x.first_name}` }))]} />
          </Field>
          <Field label={t('appt.location')}>
            <Select value={locationId ?? ''} onChange={(e) => setLoc(e.target.value ? Number(e.target.value) : null)} options={[{ value: '', label: '—' }, ...(locs.data?.rows ?? []).map((x) => ({ value: String(x.id), label: x.code }))]} />
          </Field>
        </div>
        <Field label={t('appt.kind')}>
          <Select value={kind} onChange={(e) => setKind(e.target.value)} options={[{ value: 'consultation', label: t('appt.k.consultation') }, { value: 'control', label: t('appt.k.control') }, { value: 'procedure', label: t('appt.k.procedure') }, { value: 'lab', label: t('appt.k.lab') }, { value: 'radio', label: t('appt.k.radio') }]} />
        </Field>
        <Field label={tc('notes')}>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {conflict ? (
          <p className="flex items-center gap-1.5 rounded-xl bg-[rgb(var(--c-coral-soft))] px-3 py-2 text-[12.5px] font-semibold text-[rgb(var(--c-coral))]">
            <AlertTriangle size={14} /> {t('appt.conflict')} <span dir="ltr" className="font-mono">{conflict}</span>
          </p>
        ) : null}
        <Badge tone="neutral">DZ : vendredi/samedi = weekend</Badge>
      </div>
    </Dialog>
  );
}
