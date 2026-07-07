import type { CallDirection, CallStatus, ConsentStatus } from '@crm/types';
import { colors } from '../ui';

/** Inbound ↙ / outbound ↗ glyph for a call row. */
export function directionArrow(direction: CallDirection): string {
  return direction === 'INBOUND' ? '↙' : '↗';
}

export const CALL_STATUS_COLOR: Record<CallStatus, string> = {
  RINGING: colors.brand,
  IN_PROGRESS: colors.brand,
  COMPLETED: '#16a34a',
  MISSED: '#dc2626',
  FAILED: '#dc2626',
  NO_ANSWER: '#d97706',
};

export const CONSENT_COLOR: Record<ConsentStatus, string> = {
  GRANTED: '#16a34a',
  WITHDRAWN: '#dc2626',
  NOT_CAPTURED: colors.muted,
};

export const CONSENT_LABEL: Record<ConsentStatus, string> = {
  GRANTED: 'Recording consent: granted',
  WITHDRAWN: 'Recording consent: withdrawn',
  NOT_CAPTURED: 'Recording consent: not captured',
};
