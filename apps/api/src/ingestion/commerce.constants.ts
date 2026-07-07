/** BullMQ queue for Shopify sync (backfill / nightly reconcile / webhook processing). */
export const SHOPIFY_SYNC_QUEUE = 'shopify-sync';

/** Stable id for the single repeatable reconciliation job. */
export const RECONCILE_JOB_ID = 'shopify-reconcile-repeat';

/** Divergence threshold (orders) beyond which reconciliation raises an alert. */
export const RECONCILE_ALERT_THRESHOLD = 5;

export interface BackfillJob {
  type: 'backfill';
  organizationId: string;
}

export interface ReconcileJob {
  type: 'reconcile';
  /** Omitted → reconcile every connected org (the repeatable nightly run). */
  organizationId?: string;
}

export interface WebhookJob {
  type: 'webhook';
  organizationId: string;
  topic: string;
  payload: Record<string, unknown>;
}

export type SyncJob = BackfillJob | ReconcileJob | WebhookJob;
