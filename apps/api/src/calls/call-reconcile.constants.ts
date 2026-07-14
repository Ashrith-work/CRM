/** BullMQ queue for the telephony reconciliation sweep (recovers MISSED webhooks). */
export const TELEPHONY_RECONCILE_QUEUE = 'telephony-reconcile';

/** Single repeatable job id (one sweep, refreshed on boot). */
export const RECONCILE_JOB_ID = 'telephony-reconcile-sweep';

export interface ReconcileJob {
  type: 'sweep';
}
