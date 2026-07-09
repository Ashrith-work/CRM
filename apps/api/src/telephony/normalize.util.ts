import type { CallDirection, CallStatus } from '@crm/types';

/** Shared, provider-neutral normalization of raw event fields. */

export function mapDirection(raw: string | undefined): CallDirection {
  return (raw ?? '').toLowerCase().startsWith('in') ? 'INBOUND' : 'OUTBOUND';
}

/** Map a provider status/event string (+duration hint) to our CallStatus. */
export function mapStatus(raw: string | undefined, duration: number | null): CallStatus {
  const s = (raw ?? '').toLowerCase();
  if (/(answered|complete|success)/.test(s)) return 'COMPLETED';
  if (/(missed)/.test(s)) return 'MISSED';
  if (/(no[-_ ]?answer|noanswer)/.test(s)) return 'NO_ANSWER';
  if (/(fail|busy|reject|declin)/.test(s)) return 'FAILED';
  if (/(ring)/.test(s)) return 'RINGING';
  if (/(progress|ongoing|answer)/.test(s)) return 'IN_PROGRESS';
  // No/unknown status: infer from duration.
  if (duration != null) return duration > 0 ? 'COMPLETED' : 'MISSED';
  return 'RINGING';
}

export function parseTime(raw: string | undefined): Date | null {
  if (!raw) return null;
  // Epoch seconds/millis?
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    const d = new Date(n < 1e12 ? n * 1000 : n);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? null : d;
}
