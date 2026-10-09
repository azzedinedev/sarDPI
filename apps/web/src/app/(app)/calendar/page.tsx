'use client';
/**
 * Calendrier — vue semaine (7 colonnes, heures 07→19), weekend du pays surligné (ven/sam pour DZ),
 * RTL complet (axes inversés). Interactions souris :
 *  - sélection par glisser sur la grille → création d'un RDV pré-rempli (plage début→fin) ;
 *  - glisser un bloc → déplacement horaire ; poignée basse → redimensionnement de la durée ;
 *  - clic sur un bloc → fiche de détail & édition complète (patient, praticien, lieu, statut, notes).
 * Patient, Lieu, Praticien = Autocomplete avec possibilité d'ajout rapide (modales intégrées).
 * Conflits vérifiés serveur (/appointments/conflicts, ignoreId en édition).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Edit3,
  ExternalLink,
  FileText,
  MapPin,
  Plus,
  Stethoscope,
  Tags,
  Trash2,
  User,
} from 'lucide-react';
import { api, crudFilters } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Badge, Button, Field, Select, Textarea } from '@/components/ui';
import { Dialog } from '@/components/dialogs';
import { AsyncAutocomplete, type ComboOption } from '@/components/combo';
import { CalendarKindsDialog } from '@/components/calendar-kinds-editor';
import { LocationQuickDialog } from '@/components/location-quick-dialog';
import { PatientQuickDialog } from '@/components/patient-quick-dialog';
import { PractitionerQuickDialog } from '@/components/practitioner-quick-dialog';
import { useCalendarKinds } from '@/lib/display';
import { useToast } from '@/components/toast';
import { cn, withAlpha } from '@/lib/utils';
import { workingDays } from '@/lib/format';
import { useAuth } from '@/stores/auth';

interface Appt {
  id: number;
  code: string | null;
  patient_id?: number;
  patient_name: string | null;
  patient_code?: string | null;
  practitioner_id?: number | null;
  practitioner_name?: string | null;
  location_id?: number | null;
  location_name?: string | null;
  start_at: string;
  end_at: string;
  kind: string;
  status: string;
  notes?: string | null;
}

const HOUR0 = 7;
const HOUR1 = 19;
const SLOT_MIN = 30;
const PX_PER_SLOT = 26;
const SNAP_MIN = 15; // pas d'aimantation (minutes)
const DAY_MIN = (HOUR1 - HOUR0) * 60;
const PX_PER_MIN = PX_PER_SLOT / SLOT_MIN;

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // lundi = 0
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}
const clampMin = (m: number): number => Math.max(0, Math.min(DAY_MIN, m));
const snap = (m: number): number => Math.round(m / SNAP_MIN) * SNAP_MIN;
const minsOf = (iso: string): number => {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
};
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** minute-du-jour + datetime-local → Date locale */
function dayMinToDate(day: Date, min: number): Date {
  const d = new Date(day);
  d.setHours(HOUR0 + Math.floor(min / 60), min % 60, 0, 0);
  return d;
}

type Drag =
  | { type: 'select'; day: number; anchor: number; cur: number }
  | { type: 'move'; id: number; day: number; grabOffset: number; origStart: number; dur: number; cur: number }
  | { type: 'resize'; id: number; day: number; origStart: number; curEnd: number }
  | null;

export default function CalendarPage(): React.ReactElement {
  const { t } = useT('patient');
  const { t: tc } = useT('common');
  const toast = useToast();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const has = useAuth((s) => s.has);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [dialog, setDialog] = useState<{ mode: 'create' | 'edit' | 'detail'; start?: string; end?: string; appt?: Appt } | null>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const canWrite = has('calendar', 'create') || has('appointment', 'create');
  const canUpdate = has('calendar', 'update') || has('appointment', 'update');
  // Étiquettes (types + statuts de RDV) configurables en base — réglage « calendarKinds ».
  const ck = useCalendarKinds();
  const canEditLabels = has('setting', 'update');
  const colRefs = useRef<(HTMLDivElement | null)[]>([]);
  const draggedRef = useRef(false); // supprime le « clic » qui suit un glisser (sinon la fiche s'ouvrirait)

  const from = weekStart.toISOString();
  const to = new Date(weekStart.getTime() + 7 * 86_400_000).toISOString();
  const patientFilter = sp.get('patient'); // vue « agenda d'un patient » depuis le dossier RDV
  const q = useQuery({ queryKey: ['agenda', from, to, patientFilter ?? ''], queryFn: () => api.get<{ rows: Appt[] }>(`/appointments/view?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${patientFilter ? `&patientId=${encodeURIComponent(patientFilter)}` : ''}`), refetchInterval: 60_000 });
  const rows = q.data?.rows ?? [];

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * 86_400_000)), [weekStart]);

  /** RDV groupés par jour, avec géométrie (top/height en px). */
  const byDay = useMemo(() => {
    const out = days.map(() => [] as { a: Appt; top: number; height: number; startMin: number; endMin: number }[]);
    for (const a of rows) {
      const di = days.findIndex((x) => x.toDateString() === new Date(a.start_at).toDateString());
      if (di < 0) continue;
      let startMin = minsOf(a.start_at) - HOUR0 * 60;
      let endMin = (a.end_at ? minsOf(a.end_at) : startMin + 30) - HOUR0 * 60;
      // aperçu pendant un glisser (déplacement / redimensionnement)
      if (drag && (drag.type === 'move' || drag.type === 'resize') && drag.id === a.id) {
        if (drag.type === 'move') {
          const dur = drag.dur;
          startMin = clampMin(snap(drag.cur));
          endMin = clampMin(startMin + dur);
        } else {
          startMin = drag.origStart;
          endMin = clampMin(snap(drag.curEnd));
          if (endMin <= startMin) endMin = startMin + SNAP_MIN;
        }
      }
      if (startMin < 0 || startMin >= DAY_MIN) continue;
      const top = startMin * PX_PER_MIN;
      const height = Math.max(PX_PER_SLOT * 0.8, (endMin - startMin) * PX_PER_MIN);
      out[di]!.push({ a, top, height, startMin, endMin });
    }
    return out;
  }, [rows, days, drag]);

  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['agenda'] });
  }, [qc]);

  // PUT déplacement / redimensionnement (aimanté 15 min) — conflit ignoré ici (averti à la création/édition)
  const moveMut = useMutation({
    mutationFn: ({ id, startAt, endAt }: { id: number; startAt: string; endAt: string }) => api.put(`/appointments/${id}`, { startAt, endAt }),
    onSuccess: () => {
      invalidate();
      toast.success(tc('saved'));
    },
    onError: () => toast.error(tc('notFound')),
  });

  /** minute-du-jour depuis un événement pointeur sur une colonne */
  const minuteFromEvent = (e: { clientY: number }, dayIndex: number): number => {
    const el = colRefs.current[dayIndex];
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const y = e.clientY - rect.top;
    return clampMin(snap((y / PX_PER_SLOT) * SLOT_MIN));
  };

  // fenêtre de glisser (déplacement/redimensionnement) — écouteurs globaux le temps du geste
  useEffect(() => {
    if (!drag || drag.type === 'select') return;
    const onMove = (e: PointerEvent): void => {
      if (drag.type === 'move') setDrag({ ...drag, cur: minuteFromEvent(e, drag.day) - drag.grabOffset });
      else if (drag.type === 'resize') setDrag({ ...drag, curEnd: minuteFromEvent(e, drag.day) });
    };
    const onUp = (): void => {
      const d = drag;
      setDrag(null);
      if (!d) return;
      const target = rows.find((r) => r.id === d.id);
      if (!target) return;
      const day = days[d.day]!;
      let startMin: number;
      let endMin: number;
      if (d.type === 'move') {
        startMin = clampMin(snap(d.cur));
        endMin = clampMin(startMin + d.dur);
      } else {
        startMin = d.origStart;
        endMin = clampMin(snap(d.curEnd));
        if (endMin <= startMin) endMin = startMin + SNAP_MIN;
      }
      const startAt = dayMinToDate(day, startMin + HOUR0 * 60).toISOString();
      const endAt = dayMinToDate(day, endMin + HOUR0 * 60).toISOString();
      if (startAt !== target.start_at || endAt !== target.end_at) {
        draggedRef.current = true;
        moveMut.mutate({ id: d.id, startAt, endAt });
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, rows, days]);

  const dayNames = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(tc('lang.code') === 'ar' ? 'ar' : 'fr', { weekday: 'short' });
    return days.map((d) => fmt.format(d));
  }, [days, tc]);
  const wd = workingDays();

  const onColPointerDown = (e: React.PointerEvent, dayIndex: number): void => {
    if (!canWrite || e.button !== 0) return;
    // un clic sur un bloc est géré par le bloc (stopPropagation) — ici uniquement le fond
    const anchor = minuteFromEvent(e, dayIndex);
    setDrag({ type: 'select', day: dayIndex, anchor, cur: anchor });
    const onMove = (ev: PointerEvent): void => setDrag((prev) => (prev && prev.type === 'select' ? { ...prev, cur: minuteFromEvent(ev, dayIndex) } : prev));
    const onUp = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const cur = minuteFromEvent(ev, dayIndex);
      setDrag(null);
      const a = Math.min(anchor, cur);
      const b = Math.max(anchor, cur);
      const startMin = a;
      const endMin = b <= a ? a + SLOT_MIN : b; // simple clic → créneau de 30 min
      const day = days[dayIndex]!;
      setDialog({ mode: 'create', start: toLocalInput(dayMinToDate(day, startMin + HOUR0 * 60)), end: toLocalInput(dayMinToDate(day, endMin + HOUR0 * 60)) });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startBlockDrag = (e: React.PointerEvent, a: Appt, dayIndex: number, mode: 'move' | 'resize'): void => {
    if (!canUpdate || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const startMin = minsOf(a.start_at) - HOUR0 * 60;
    const endMin = (a.end_at ? minsOf(a.end_at) : startMin + 30) - HOUR0 * 60;
    const dur = Math.max(SNAP_MIN, endMin - startMin);
    if (mode === 'move') {
      const grabOffset = minuteFromEvent(e, dayIndex) - startMin;
      setDrag({ type: 'move', id: a.id, day: dayIndex, grabOffset, origStart: startMin, dur, cur: startMin });
    } else {
      setDrag({ type: 'resize', id: a.id, day: dayIndex, origStart: startMin, curEnd: endMin });
    }
  };

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => api.post(`/appointments/${id}/status`, { status }),
    onSuccess: () => invalidate(),
  });

  // sélection en cours (surbrillance plage)
  const selRange = drag && drag.type === 'select' ? { day: drag.day, a: Math.min(drag.anchor, drag.cur), b: Math.max(drag.anchor, drag.cur) } : null;

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
          {days[0]!.toLocaleDateString()} → {days[6]!.toLocaleDateString()}
        </span>
        <span className="hidden text-[11.5px] text-[rgb(var(--c-muted))] md:inline">{t('cal.dragHint')}</span>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {canEditLabels ? (
            <Button size="sm" variant="ghost" onClick={() => setLabelsOpen(true)}>
              <Tags size={14} /> {t('cal.editLabels')}
            </Button>
          ) : null}
          {canWrite ? (
            <Button size="sm" variant="primary" onClick={() => setDialog({ mode: 'create', start: toLocalInput(new Date(weekStart.getTime() + 9 * 3600_000)), end: toLocalInput(new Date(weekStart.getTime() + 9.5 * 3600_000)) })}>
              <Plus size={14} /> {t('appt.new')}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Légende — couleurs, libellés et durées proviennent du réglage « calendarKinds » (base). */}
      <div className="glass-card flex flex-wrap items-center gap-x-3 gap-y-1.5 !px-3 !py-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-[rgb(var(--c-muted))]">{t('cal.legend')}</span>
        {ck.kinds.map((k) => (
          <span key={k.key} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[rgb(var(--c-ink))]">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: k.color }} />
            {k.label}
            <span dir="ltr" className="font-mono text-[10.5px] font-medium text-[rgb(var(--c-muted))]">
              {k.durationMin}′
            </span>
          </span>
        ))}
      </div>

      <div className="glass-card overflow-x-auto !p-0">
        <div className="min-w-[860px]">
          {/* entête jours */}
          <div className="grid border-b border-[rgb(var(--c-line))] [grid-template-columns:64px_repeat(7,1fr)]">
            <div />
            {days.map((d, i) => {
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
                <div key={s} className="flex items-start justify-end pe-1 font-mono text-[9.5px] text-[rgb(var(--c-muted))]" style={{ height: PX_PER_SLOT }}>
                  {s % 2 === 0 ? `${HOUR0 + s / 2}:00` : ''}
                </div>
              ))}
            </div>
            {days.map((d, di) => (
              <div
                key={di}
                ref={(el) => {
                  colRefs.current[di] = el;
                }}
                className={cn('relative touch-none border-s border-[rgb(var(--c-line)/0.6)] select-none', !wd.includes(d.getDay()) && 'bg-[rgb(var(--c-surface-2)/0.45)]', canWrite && 'cursor-crosshair')}
                style={{ height: DAY_MIN * PX_PER_MIN }}
                onPointerDown={(e) => onColPointerDown(e, di)}
              >
                {Array.from({ length: (HOUR1 - HOUR0) * 2 }, (_, s) => (
                  <div key={s} className={cn('pointer-events-none absolute inset-x-0 border-t', s % 2 === 0 ? 'border-[rgb(var(--c-line)/0.55)]' : 'border-[rgb(var(--c-line)/0.2)]')} style={{ top: s * PX_PER_SLOT, height: PX_PER_SLOT }} />
                ))}
                {/* surbrillance de la sélection en cours */}
                {selRange && selRange.day === di && selRange.b > selRange.a ? (
                  <div className="pointer-events-none absolute inset-x-0.5 z-20 rounded-lg border border-[rgb(var(--c-primary)/0.6)] bg-[rgb(var(--c-primary)/0.18)]" style={{ top: selRange.a * PX_PER_MIN, height: (selRange.b - selRange.a) * PX_PER_MIN }} />
                ) : null}
                {byDay[di]!.map(({ a, top, height, startMin }) => (
                  <motion.div
                    key={a.id}
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className={cn(
                      'absolute inset-x-0.5 z-10 overflow-hidden rounded-lg border px-1.5 py-1 text-[10.5px] font-semibold shadow-sm',
                      a.status === 'done' && 'opacity-60',
                      a.status === 'cancelled' && 'opacity-30 line-through',
                      canUpdate ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                    )}
                    // Couleurs pilotées par le réglage « calendarKinds » : le statut teint le bloc,
                    // le type de RDV marque le bord d'attaque (logique, donc inversé en RTL).
                    style={{
                      top,
                      height,
                      background: withAlpha(ck.statusColor(a.status), 0.14),
                      borderColor: withAlpha(ck.statusColor(a.status), 0.5),
                      borderInlineStartColor: withAlpha(ck.kindColor(a.kind), 0.95),
                      borderInlineStartWidth: 3,
                    }}
                    title={`${a.patient_name ?? ''} — ${ck.kindLabel(a.kind)} · ${ck.statusLabel(a.status)}`}
                    onPointerDown={(e) => startBlockDrag(e, a, di, 'move')}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (drag) return;
                      if (draggedRef.current) {
                        draggedRef.current = false;
                        return;
                      }
                      setDialog({ mode: 'detail', appt: a });
                    }}
                  >
                    <div className="flex items-center gap-1">
                      <span className="font-mono text-[9.5px] opacity-80">{fmtMin(startMin + HOUR0 * 60)}</span>
                      <button className="min-w-0 flex-1 truncate text-start font-bold" onClick={(e) => { e.stopPropagation(); setDialog({ mode: 'detail', appt: a }); }}>
                        {a.patient_name ?? t('appt.orphan')}
                      </button>
                    </div>
                    <div className="flex items-center gap-1 text-[9px] opacity-80">
                      <span className="truncate">{ck.kindLabel(a.kind)}</span>
                      {has('calendar', 'update') || has('appointment', 'update') ? (
                        <select
                          className="ms-auto w-16 rounded border-0 bg-transparent text-[9px] font-bold outline-none"
                          value={a.status}
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          onChange={(e) => setStatus.mutate({ id: a.id, status: e.target.value })}
                        >
                          {ck.statuses.map((st) => (
                            <option key={st.key} value={st.key}>
                              {st.label}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </div>
                    {/* poignée de redimensionnement (bas) */}
                    {canUpdate ? (
                      <div
                        className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize bg-[rgb(var(--c-primary)/0.0)] hover:bg-[rgb(var(--c-primary)/0.25)]"
                        onPointerDown={(e) => startBlockDrag(e, a, di, 'resize')}
                        onClick={(e) => e.stopPropagation()}
                        title={t('cal.resizeHint')}
                      />
                    ) : null}
                  </motion.div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <ApptDialog
        state={dialog}
        onClose={() => setDialog(null)}
        onSaved={() => {
          setDialog(null);
          invalidate();
          toast.success(tc('saved'));
        }}
        patientHint={sp.get('patient') ? Number(sp.get('patient')) : undefined}
      />

      {/* Étiquettes (types + statuts) — réservées aux profils pouvant modifier les réglages. */}
      {canEditLabels ? <CalendarKindsDialog open={labelsOpen} onClose={() => setLabelsOpen(false)} /> : null}
    </div>
  );
}

function fmtMin(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Fiche RDV — affichage détaillé, création ou édition avec sélection & ajout rapide patient/lieu/praticien. */
function ApptDialog({
  state,
  onClose,
  onSaved,
  patientHint,
}: {
  state: { mode: 'create' | 'edit' | 'detail'; start?: string; end?: string; appt?: Appt } | null;
  onClose: () => void;
  onSaved: () => void;
  patientHint?: number;
}): React.ReactElement {
  const { t } = useT('patient');
  const { t: tc } = useT('common');
  const toast = useToast();
  const qc = useQueryClient();
  const has = useAuth((s) => s.has);
  const open = Boolean(state);

  const [curMode, setCurMode] = useState<'create' | 'edit' | 'detail'>('create');
  const [currentAppt, setCurrentAppt] = useState<Appt | null>(null);

  const [patient, setPatient] = useState<ComboOption | null>(null);
  const [practitioner, setPractitioner] = useState<ComboOption | null>(null);
  const [locationOption, setLocationOption] = useState<ComboOption | null>(null);
  const [locationId, setLoc] = useState<number | null>(null);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [kind, setKind] = useState('consultation');
  const [status, setStatus] = useState('pending');
  const [notes, setNotes] = useState('');
  const [conflict, setConflict] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Modales d'ajout rapide
  const [quickPatientOpen, setQuickPatientOpen] = useState(false);
  const [quickPractOpen, setQuickPractOpen] = useState(false);
  const [quickLocOpen, setQuickLocOpen] = useState(false);

  const ck = useCalendarKinds();
  const defaultKind = ck.kinds[0]?.key ?? 'consultation';
  const defaultStatus = ck.statuses[0]?.key ?? 'pending';

  const canUpdate = has('calendar', 'update') || has('appointment', 'update');
  const canDelete = has('calendar', 'delete') || has('appointment', 'delete') || canUpdate;

  const practs = useQuery({
    queryKey: ['pract-lite', 'active'],
    queryFn: () =>
      api.get<{ rows: { id: number; code: string; last_name: string; first_name: string }[] }>('/practitioners', {
        pageSize: 100,
        filters: crudFilters([{ field: 'active', value: 1 }]),
      }),
    enabled: open,
  });

  const locs = useQuery({
    queryKey: ['loc-lite', 'active'],
    queryFn: () =>
      api.get<{ rows: { id: number; code: string; name?: string; building?: string; kind: string }[] }>('/locations', {
        pageSize: 100,
        filters: crudFilters([{ field: 'active', value: 1 }]),
      }),
    enabled: open,
  });

  const practOptions: ComboOption[] = useMemo(
    () =>
      (practs.data?.rows ?? []).map((x) => ({
        value: String(x.id),
        label: `Dr ${x.last_name} ${x.first_name}`.trim(),
        sublabel: x.code,
      })),
    [practs.data],
  );

  const locOptions: ComboOption[] = useMemo(
    () =>
      (locs.data?.rows ?? []).map((x) => ({
        value: String(x.id),
        label: `${x.name || x.code} (${x.code})`,
        sublabel: [x.kind, x.building].filter(Boolean).join(' · '),
      })),
    [locs.data],
  );

  const fetchPatients = useCallback(
    (qTerm: string) =>
      api
        .get<{ rows: { id: number; code: string; full_name?: string; last_name?: string; first_name?: string }[] }>(
          `/patients/search?q=${encodeURIComponent(qTerm)}`,
        )
        .then((r) =>
          r.rows.map((p) => ({
            value: String(p.id),
            label: p.full_name ?? `${(p.last_name ?? '').toUpperCase()} ${p.first_name ?? ''}`.trim(),
            sublabel: p.code,
          })),
        ),
    [],
  );

  // (ré)initialisation à chaque ouverture
  useEffect(() => {
    if (!state) return;
    setConflict(null);
    setConfirmDelete(false);
    setCurMode(state.mode);
    const appt = state.appt ?? null;
    setCurrentAppt(appt);

    if (appt) {
      setPatient(
        appt.patient_id
          ? {
              value: String(appt.patient_id),
              label: appt.patient_name ?? `#${appt.patient_id}`,
              sublabel: appt.patient_code ?? undefined,
            }
          : null,
      );
      setPractitioner(
        appt.practitioner_id
          ? {
              value: String(appt.practitioner_id),
              label: appt.practitioner_name ? `Dr ${appt.practitioner_name}` : `#${appt.practitioner_id}`,
            }
          : null,
      );
      setLoc(appt.location_id ? Number(appt.location_id) : null);
      if (appt.location_id) {
        const found = locOptions.find((o) => o.value === String(appt.location_id));
        setLocationOption(
          found ?? (appt.location_name ? { value: String(appt.location_id), label: appt.location_name } : null),
        );
      } else {
        setLocationOption(null);
      }
      setStart(toLocalInput(new Date(appt.start_at)));
      setEnd(toLocalInput(new Date(appt.end_at)));
      setKind(appt.kind ?? defaultKind);
      setStatus(appt.status ?? defaultStatus);
      setNotes(appt.notes ?? '');
    } else {
      setPatient(patientHint ? { value: String(patientHint), label: `#${patientHint}` } : null);
      setPractitioner(null);
      setLoc(null);
      setLocationOption(null);
      setStart(state.start ?? '');
      setEnd(state.end ?? '');
      setKind(defaultKind);
      setStatus(defaultStatus);
      setNotes('');
      if (patientHint) void resolvePatient(patientHint).then(setPatient);
    }
  }, [state, locOptions, defaultKind, defaultStatus, patientHint]);

  const mut = useMutation({
    mutationFn: async () => {
      const st = new Date(start);
      // fin par défaut = durée configurée du type de RDV (réglage « calendarKinds »)
      const en = end ? new Date(end) : new Date(st.getTime() + ck.kindDuration(kind) * 60_000);
      const body = {
        patientId: patient ? Number(patient.value) : null,
        practitionerId: practitioner ? Number(practitioner.value) : null,
        locationId,
        startAt: st.toISOString(),
        endAt: en.toISOString(),
        kind,
        status,
        notes: notes || null,
      };
      if (practitioner || locationId) {
        const c = await api.post<{ conflicts: { code: string }[] }>('/appointments/conflicts', {
          practitionerId: body.practitionerId,
          locationId,
          startAt: body.startAt,
          endAt: body.endAt,
          ignoreId: currentAppt?.id,
        });
        if (c.conflicts.length) throw new Error(`conflict:${c.conflicts[0]!.code}`);
      }
      if (curMode === 'edit' && currentAppt) return api.put(`/appointments/${currentAppt.id}`, body);
      return api.post('/appointments', body);
    },
    onSuccess: onSaved,
    onError: (e: Error) => (e.message.startsWith('conflict:') ? setConflict(e.message.slice(9)) : setConflict('!')),
  });

  const delMut = useMutation({
    mutationFn: async () => {
      if (!currentAppt) return;
      return api.del(`/appointments/${currentAppt.id}`);
    },
    onSuccess: () => {
      toast.success(tc('deleted'));
      onSaved();
    },
    onError: () => toast.error(tc('common.error')),
  });

  const changeStatusMut = useMutation({
    mutationFn: async (newSt: string) => {
      if (!currentAppt) return;
      return api.post(`/appointments/${currentAppt.id}/status`, { status: newSt });
    },
    onSuccess: (_, newSt) => {
      toast.success(tc('saved'));
      setStatus(newSt);
      if (currentAppt) currentAppt.status = newSt;
      void qc.invalidateQueries({ queryKey: ['agenda'] });
    },
    onError: () => toast.error(tc('common.error')),
  });

  // Vue DÉTAIL d'un rendez-vous
  if (curMode === 'detail' && currentAppt) {
    const stDate = new Date(currentAppt.start_at);
    const enDate = new Date(currentAppt.end_at);
    const diffMinutes = Math.max(1, Math.round((enDate.getTime() - stDate.getTime()) / 60000));
    const langCode = tc('lang.code') === 'ar' ? 'ar-DZ' : 'fr-FR';
    const dateFormatted = stDate.toLocaleDateString(langCode, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const startTimeFormatted = stDate.toLocaleTimeString(langCode, {
      hour: '2-digit',
      minute: '2-digit',
    });
    const endTimeFormatted = enDate.toLocaleTimeString(langCode, {
      hour: '2-digit',
      minute: '2-digit',
    });

    return (
      <Dialog
        open={open}
        onClose={onClose}
        title={
          <div className="flex flex-wrap items-center gap-2">
            <span>{t('cal.title')} · {currentAppt.code ?? `RDV-${currentAppt.id}`}</span>
            <span
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold"
              style={{
                background: withAlpha(ck.statusColor(currentAppt.status), 0.15),
                color: ck.statusColor(currentAppt.status),
                borderColor: withAlpha(ck.statusColor(currentAppt.status), 0.4),
              }}
            >
              {ck.statusLabel(currentAppt.status)}
            </span>
            <span
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold"
              style={{
                borderInlineStartColor: ck.kindColor(currentAppt.kind),
                borderInlineStartWidth: 3,
                background: withAlpha(ck.kindColor(currentAppt.kind), 0.12),
              }}
            >
              {ck.kindLabel(currentAppt.kind)}
            </span>
          </div>
        }
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div>
              {canDelete ? (
                confirmDelete ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] font-semibold text-[rgb(var(--c-coral))]">{tc('common.confirmDelete')}</span>
                    <Button size="sm" variant="danger" loading={delMut.isPending} onClick={() => delMut.mutate()}>
                      {tc('actions.confirm')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                      {tc('cancel')}
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="ghost" className="text-[rgb(var(--c-coral))] hover:bg-[rgb(var(--c-coral)/0.1)]" onClick={() => setConfirmDelete(true)}>
                    <Trash2 size={14} /> {tc('delete')}
                  </Button>
                )
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" onClick={onClose}>
                {tc('actions.close')}
              </Button>
              {currentAppt.patient_id ? (
                <Button size="sm" variant="ghost" onClick={() => (window.location.href = `/records/CON?new=1&patient=${currentAppt.patient_id}&appt=${currentAppt.id}`)}>
                  <Plus size={13} /> {t('appt.createRecord')}
                </Button>
              ) : null}
              {canUpdate ? (
                <Button size="sm" variant="primary" onClick={() => setCurMode('edit')}>
                  <Edit3 size={14} /> {tc('edit')}
                </Button>
              ) : null}
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-3.5">
          {/* Patient Card */}
          <div className="rounded-xl border border-[rgb(var(--c-line)/0.8)] bg-[rgb(var(--c-surface-2)/0.4)] p-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[rgb(var(--c-primary)/0.15)] text-[14px] font-bold text-[rgb(var(--c-primary))]">
                  <User size={18} />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[14.5px] font-bold text-[rgb(var(--c-ink))]">
                    {currentAppt.patient_name ?? t('appt.orphan')}
                  </div>
                  {currentAppt.patient_code ? (
                    <div className="font-mono text-[11px] text-[rgb(var(--c-muted))]">
                      {currentAppt.patient_code}
                    </div>
                  ) : null}
                </div>
              </div>
              {currentAppt.patient_id ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => (window.location.href = `/patients/${currentAppt.patient_id}`)}
                >
                  <ExternalLink size={13} /> {t('appt.openPatient')}
                </Button>
              ) : null}
            </div>
          </div>

          {/* Date & Time info */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div className="flex items-start gap-2.5 rounded-xl border border-[rgb(var(--c-line)/0.6)] p-3">
              <span className="mt-0.5 text-[rgb(var(--c-primary))]">
                <Calendar size={17} />
              </span>
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[rgb(var(--c-muted))]">
                  {tc('date')}
                </div>
                <div className="text-[13.5px] font-medium capitalize text-[rgb(var(--c-ink))]">
                  {dateFormatted}
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2.5 rounded-xl border border-[rgb(var(--c-line)/0.6)] p-3">
              <span className="mt-0.5 text-[rgb(var(--c-primary))]">
                <Clock size={17} />
              </span>
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[rgb(var(--c-muted))]">
                  {t('appt.duration')}
                </div>
                <div className="font-mono text-[13.5px] font-bold text-[rgb(var(--c-ink))]">
                  {startTimeFormatted} → {endTimeFormatted}
                  <span className="ms-2 text-[11.5px] font-normal text-[rgb(var(--c-muted))]">
                    ({diffMinutes} min)
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Practitioner & Location info */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div className="flex items-start gap-2.5 rounded-xl border border-[rgb(var(--c-line)/0.6)] p-3">
              <span className="mt-0.5 text-[rgb(var(--c-primary))]">
                <Stethoscope size={17} />
              </span>
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[rgb(var(--c-muted))]">
                  {t('appt.practitioner')}
                </div>
                <div className="truncate text-[13px] font-medium text-[rgb(var(--c-ink))]">
                  {currentAppt.practitioner_name ? (currentAppt.practitioner_name.startsWith('Dr') ? currentAppt.practitioner_name : `Dr ${currentAppt.practitioner_name}`) : '—'}
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2.5 rounded-xl border border-[rgb(var(--c-line)/0.6)] p-3">
              <span className="mt-0.5 text-[rgb(var(--c-primary))]">
                <MapPin size={17} />
              </span>
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[rgb(var(--c-muted))]">
                  {t('appt.location')}
                </div>
                <div className="truncate text-[13px] font-medium text-[rgb(var(--c-ink))]">
                  {currentAppt.location_name || '—'}
                </div>
              </div>
            </div>
          </div>

          {/* Quick status changer */}
          {canUpdate ? (
            <div className="rounded-xl border border-[rgb(var(--c-line)/0.6)] p-3">
              <Field label={t('appt.statusField')}>
                <Select
                  value={currentAppt.status}
                  onChange={(e) => changeStatusMut.mutate(e.target.value)}
                  options={ck.statusOptions}
                />
              </Field>
            </div>
          ) : null}

          {/* Notes / observations */}
          <div className="rounded-xl border border-[rgb(var(--c-line)/0.6)] p-3">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[rgb(var(--c-muted))]">
              <FileText size={14} /> {tc('notes')}
            </div>
            <div className="text-[13px] whitespace-pre-wrap text-[rgb(var(--c-ink))]">
              {currentAppt.notes || <span className="text-[rgb(var(--c-muted))] italic">Aucun motif ou observation spécifié.</span>}
            </div>
          </div>
        </div>
      </Dialog>
    );
  }

  // Vue CRÉATION ou MODIFICATION
  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title={curMode === 'edit' ? `${t('appt.edit')} — ${currentAppt?.code ?? ''}` : t('appt.new')}
        footer={
          <>
            {curMode === 'edit' ? (
              <Button onClick={() => setCurMode('detail')}>{tc('back')}</Button>
            ) : (
              <Button onClick={onClose}>{tc('cancel')}</Button>
            )}
            <Button variant="primary" disabled={!patient || !start} loading={mut.isPending} onClick={() => mut.mutate()}>
              {tc('save')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {/* Patient Autocomplete + Quick-add */}
          <Field label={t('appt.patient')} required>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <AsyncAutocomplete
                  value={patient}
                  fetchOptions={fetchPatients}
                  minChars={2}
                  onChange={setPatient}
                  placeholder={t('list.searchPlaceholder')}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setQuickPatientOpen(true)}
                title={t('list.new')}
                className="shrink-0"
              >
                <Plus size={15} /> <span className="hidden sm:inline">{tc('actions.add')}</span>
              </Button>
            </div>
          </Field>

          {/* Horaires début / fin */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label={t('appt.start')} required>
              <input type="datetime-local" className="field" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label={t('appt.end')}>
              <input type="datetime-local" className="field" value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </div>

          {/* Praticien & Lieu Autocomplete + Quick-add */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label={t('appt.practitioner')}>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <AsyncAutocomplete
                    value={practitioner}
                    options={practOptions}
                    onChange={setPractitioner}
                    placeholder="Rechercher un praticien…"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setQuickPractOpen(true)}
                  title="Nouveau praticien"
                  className="shrink-0"
                >
                  <Plus size={15} />
                </Button>
              </div>
            </Field>

            <Field label={t('appt.location')}>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <AsyncAutocomplete
                    value={locationOption}
                    options={locOptions}
                    onChange={(opt) => {
                      setLocationOption(opt);
                      setLoc(opt ? Number(opt.value) : null);
                    }}
                    placeholder="Rechercher un lieu…"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setQuickLocOpen(true)}
                  title="Nouveau lieu"
                  className="shrink-0"
                >
                  <Plus size={15} />
                </Button>
              </div>
            </Field>
          </div>

          {/* Type & Statut */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label={t('appt.kind')}>
              <Select value={kind} onChange={(e) => setKind(e.target.value)} options={ck.kindOptions} />
            </Field>
            {curMode === 'edit' ? (
              <Field label={t('appt.statusField')}>
                <Select value={status} onChange={(e) => setStatus(e.target.value)} options={ck.statusOptions} />
              </Field>
            ) : null}
          </div>

          {/* Observations */}
          <Field label={tc('notes')}>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Motif, observations…" />
          </Field>

          {/* Conflits */}
          {conflict ? (
            <p className="flex items-center gap-1.5 rounded-xl bg-[rgb(var(--c-coral-soft))] px-3 py-2 text-[12.5px] font-semibold text-[rgb(var(--c-coral))]">
              <AlertTriangle size={14} /> {t('appt.conflict')} <span dir="ltr" className="font-mono">{conflict}</span>
            </p>
          ) : null}
          <Badge tone="neutral">DZ : vendredi/samedi = weekend</Badge>
        </div>
      </Dialog>

      {/* Modales d'ajout rapide connectées */}
      <PatientQuickDialog
        open={quickPatientOpen}
        onClose={() => setQuickPatientOpen(false)}
        onSaved={(p) => setPatient({ value: String(p.id), label: p.name, sublabel: p.code })}
      />
      <PractitionerQuickDialog
        open={quickPractOpen}
        onClose={() => setQuickPractOpen(false)}
        onSaved={(pr) => setPractitioner({ value: String(pr.id), label: pr.name, sublabel: pr.code })}
      />
      <LocationQuickDialog
        open={quickLocOpen}
        onClose={() => setQuickLocOpen(false)}
        onSaved={(l) => {
          const opt = { value: String(l.id), label: `${l.name} (${l.code})`, sublabel: l.code };
          setLocationOption(opt);
          setLoc(l.id);
        }}
      />
    </>
  );
}

async function resolvePatient(id: number): Promise<ComboOption | null> {
  try {
    const p = await api.get<{ id: number; code: string; last_name: string; first_name: string }>(`/patients/${id}`);
    return { value: String(p.id), label: `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim(), sublabel: p.code };
  } catch {
    return { value: String(id), label: `#${id}` };
  }
}
