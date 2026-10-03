/**
 * HISTORIQUE PATIENT — tous les modules y écrivent (timeline réduite + détail JSON).
 * Volontairement indépendant de l'audit : l'audit = sécurité technique ; l'historique = clinique (clinician-facing).
 */
import { getDb } from '../data';
import type { MultiLabel } from '@sardpi/shared';

export interface HistoryWrite {
  patientId: number;
  kind: 'profile' | 'record' | 'rx' | 'ged' | 'case' | 'movement' | 'appointment' | 'note' | 'consent' | 'message';
  refId?: number | null;
  refCode?: string | null;
  summary?: MultiLabel | null;
  detail?: Record<string, unknown> | null;
  occurredAt?: string;
}

export async function pushHistory(actorUserId: number | null, w: HistoryWrite): Promise<void> {
  const db = await getDb();
  await db.insert('history_events', {
    patient_id: w.patientId,
    kind: w.kind,
    ref_id: w.refId ?? null,
    ref_code: w.refCode ?? null,
    actor_user_id: actorUserId,
    occurred_at: w.occurredAt ?? new Date().toISOString(),
    summary_json: w.summary ?? null,
    detail_json: w.detail ?? null,
  });
}
