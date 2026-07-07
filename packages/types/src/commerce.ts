import { z } from 'zod';
import { IntegrationStatusSchema } from './integrations';

/**
 * Milestone 1 (commerce) — Shopify ingestion contracts. Money is ALWAYS integer
 * minor units (paise). Enum values mirror the Prisma enums (uppercase); the
 * Shopify mappers translate the provider's lowercase strings into these.
 */

// ---------------------------------------------------------------------------
// Enums.
// ---------------------------------------------------------------------------
export const ORDER_STATUSES = ['PENDING', 'PAID', 'FULFILLED', 'CANCELLED', 'REFUNDED'] as const;
export const OrderStatusSchema = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const FINANCIAL_STATUSES = ['PENDING', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'] as const;
export const FinancialStatusSchema = z.enum(FINANCIAL_STATUSES);
export type FinancialStatus = z.infer<typeof FinancialStatusSchema>;

export const COMMERCE_EVENT_TYPES = ['CHECKOUT_STARTED', 'ADD_TO_CART', 'ORDER_PLACED'] as const;
export const CommerceEventTypeSchema = z.enum(COMMERCE_EVENT_TYPES);
export type CommerceEventType = z.infer<typeof CommerceEventTypeSchema>;

/** Shopify webhook topics this pipeline handles. */
export const SHOPIFY_WEBHOOK_TOPICS = [
  'orders/create',
  'orders/updated',
  'orders/paid',
  'orders/cancelled',
  'refunds/create',
  'customers/create',
  'customers/update',
  'checkouts/create',
  'checkouts/update',
] as const;
export type ShopifyWebhookTopic = (typeof SHOPIFY_WEBHOOK_TOPICS)[number];

// ---------------------------------------------------------------------------
// Connection + sync status (the only UI surface in M1: the Settings panel).
// ---------------------------------------------------------------------------
export const ConnectShopifyInput = z.object({
  /** e.g. "nerige.myshopify.com". The Admin access token comes from env. */
  shopDomain: z.string().min(1).max(255),
  apiVersion: z.string().optional(),
});
export type ConnectShopifyInput = z.infer<typeof ConnectShopifyInput>;

/** Live sync-job progress shown in the panel (JobStatus). */
export const SyncJobStatusSchema = z.object({
  state: z.enum(['idle', 'running', 'completed', 'failed']),
  phase: z.string().nullable(),
  processed: z.number().int(),
  total: z.number().int().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  error: z.string().nullable(),
});
export type SyncJobStatus = z.infer<typeof SyncJobStatusSchema>;

export const ShopifyStatusSchema = z.object({
  provider: z.literal('shopify'),
  status: IntegrationStatusSchema, // CONNECTED | DISCONNECTED | ERROR | PAUSED
  shopDomain: z.string().nullable(),
  apiVersion: z.string().nullable(),
  lastSyncedAt: z.string().nullable(),
  /** Order count in the CRM (this org). */
  crmOrderCount: z.number().int(),
  /** Order count reported by Shopify (null when disconnected / unavailable). */
  shopifyOrderCount: z.number().int().nullable(),
  /** When status is DISCONNECTED/ERROR — a human-readable reason (no crash). */
  reason: z.string().nullable(),
  sync: SyncJobStatusSchema.nullable(),
});
export type ShopifyStatus = z.infer<typeof ShopifyStatusSchema>;

export const SyncNowResponseSchema = z.object({ enqueued: z.boolean(), jobId: z.string().nullable() });
export type SyncNowResponse = z.infer<typeof SyncNowResponseSchema>;

// ---------------------------------------------------------------------------
// Identity — manual merge (admin).
// ---------------------------------------------------------------------------
export const MergeCustomersInput = z
  .object({ survivorId: z.string().min(1), mergedId: z.string().min(1) })
  .refine((v) => v.survivorId !== v.mergedId, { message: 'survivorId and mergedId must differ', path: ['mergedId'] });
export type MergeCustomersInput = z.infer<typeof MergeCustomersInput>;

export const CustomerSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  externalId: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  mergedIntoId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Customer = z.infer<typeof CustomerSchema>;

export const MergeResultSchema = z.object({
  survivor: CustomerSchema,
  merged: CustomerSchema,
  reattributed: z.object({ orders: z.number().int(), carts: z.number().int(), events: z.number().int() }),
});
export type MergeResult = z.infer<typeof MergeResultSchema>;
