'use client';

import type { CallStatus, ConsentStatus, CallDirection } from '@crm/types';

/** Call duration as "3m 05s" / "45s" / "1h 02m". */
export function formatCallDuration(seconds: number | null): string {
  if (seconds === null || seconds < 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

const CALL_STATUS_BADGE: Record<CallStatus, string> = {
  RINGING: 'bg-amber-50 text-amber-700',
  IN_PROGRESS: 'bg-brand-50 text-brand-700',
  COMPLETED: 'bg-green-50 text-green-700',
  MISSED: 'bg-red-50 text-red-700',
  FAILED: 'bg-red-50 text-red-700',
  NO_ANSWER: 'bg-slate-100 text-slate-600',
};

export function CallStatusBadge({ status }: { status: CallStatus }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${CALL_STATUS_BADGE[status]}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

/** ↙ inbound / ↗ outbound. */
export function DirectionIcon({ direction }: { direction: CallDirection }) {
  const inbound = direction === 'INBOUND';
  return (
    <span
      title={inbound ? 'Inbound' : 'Outbound'}
      className={`inline-flex items-center gap-1 text-xs font-medium ${inbound ? 'text-sky-600' : 'text-violet-600'}`}
    >
      <span aria-hidden>{inbound ? '↙' : '↗'}</span>
      {inbound ? 'In' : 'Out'}
    </span>
  );
}

const CONSENT_BADGE: Record<ConsentStatus, string> = {
  GRANTED: 'bg-green-50 text-green-700',
  WITHDRAWN: 'bg-red-50 text-red-700',
  NOT_CAPTURED: 'bg-slate-100 text-slate-600',
};

const CONSENT_LABEL: Record<ConsentStatus, string> = {
  GRANTED: 'Consent granted',
  WITHDRAWN: 'Consent withdrawn',
  NOT_CAPTURED: 'Consent not captured',
};

export function ConsentBadge({ status }: { status: ConsentStatus | null }) {
  const s = status ?? 'NOT_CAPTURED';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${CONSENT_BADGE[s]}`}>
      <span aria-hidden>🔒</span>
      {CONSENT_LABEL[s]}
    </span>
  );
}
