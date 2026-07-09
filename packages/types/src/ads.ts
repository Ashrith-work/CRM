import { z } from 'zod';
import { IntegrationStatusSchema } from './integrations';

/**
 * P2.3 — Meta ads + attribution + audience sync. WIRE shapes only. Money is
 * integer minor units (paise); time is UTC ISO. Attribution defaults to
 * FIRST-TOUCH and the model is always labelled. Meta-reported conversions are
 * shown next to store-actual orders; store-actual is preferred for revenue.
 */

// ---------------------------------------------------------------------------
// Meta hierarchy + metrics.
// ---------------------------------------------------------------------------
export const AD_ENTITY_TYPES = ['campaign', 'adset', 'ad', 'creative'] as const;
export const AdEntityTypeSchema = z.enum(AD_ENTITY_TYPES);
export type AdEntityType = z.infer<typeof AdEntityTypeSchema>;

// ---------------------------------------------------------------------------
// Connect + status (Meta integration). IntegrationStatusSchema + SyncNowResponse
// are shared with the commerce/integrations modules (reused, not redefined).
// ---------------------------------------------------------------------------

/** Non-secret connect input; the system-user token comes from env, never the body. */
export const ConnectMetaInput = z.object({
  adAccountId: z.string().min(1).optional(),
  businessId: z.string().min(1).optional(),
});
export type ConnectMetaInput = z.infer<typeof ConnectMetaInput>;

export const MetaStatusSchema = z.object({
  provider: z.literal('meta'),
  status: IntegrationStatusSchema,
  adAccountId: z.string().nullable(),
  businessId: z.string().nullable(),
  apiVersion: z.string(),
  lastSyncedAt: z.string().nullable(),
  /** Rows currently held in AdMetricDaily (a quick "is data flowing" signal). */
  metricRowCount: z.number().int(),
  reason: z.string().nullable(),
});
export type MetaStatus = z.infer<typeof MetaStatusSchema>;

// ---------------------------------------------------------------------------
// Attribution models + source ROI.
// ---------------------------------------------------------------------------
export const ATTRIBUTION_MODELS = ['first_touch', 'last_touch', 'linear', 'time_decay'] as const;
export const AttributionModelSchema = z.enum(ATTRIBUTION_MODELS);
export type AttributionModel = z.infer<typeof AttributionModelSchema>;

export const SourceRoiRowSchema = z.object({
  source: z.string(),
  customersAcquired: z.number().int(),
  spendMinor: z.number().int(),
  ltvTotalMinor: z.number().int(),
  avgLtvMinor: z.number().int(),
  /** Null when there is no spend for the source (organic/unknown). */
  cacMinor: z.number().int().nullable(),
  /** LTV:CAC ratio; null when CAC is unknown. */
  ltvCacRatio: z.number().nullable(),
  /** CAC payback period in months; null when it can't be computed. */
  paybackMonths: z.number().nullable(),
  /** ROAS = store-actual revenue ÷ spend; null when no spend. */
  roas: z.number().nullable(),
});
export type SourceRoiRow = z.infer<typeof SourceRoiRowSchema>;

export const SourceRoiResponseSchema = z.object({
  /** The attribution model this view was bucketed on (labelled in the UI). */
  model: AttributionModelSchema,
  currency: z.string().nullable(),
  /** Share of acquired customers with a known (non-"unknown") first-touch. */
  coveragePct: z.number(),
  data: z.array(SourceRoiRowSchema),
});
export type SourceRoiResponse = z.infer<typeof SourceRoiResponseSchema>;

// ---------------------------------------------------------------------------
// Order-level attribution coverage (orders with a known source ÷ all orders).
// ---------------------------------------------------------------------------
export const OrderSourceCountSchema = z.object({ source: z.string(), orders: z.number().int() });
export type OrderSourceCount = z.infer<typeof OrderSourceCountSchema>;

export const OrderCoverageResponseSchema = z.object({
  totalOrders: z.number().int(),
  ordersWithKnownSource: z.number().int(),
  /** ordersWithKnownSource ÷ totalOrders × 100. */
  coveragePct: z.number(),
  /** First-touch source breakdown by order count (incl. "unknown"). */
  bySource: z.array(OrderSourceCountSchema),
});
export type OrderCoverageResponse = z.infer<typeof OrderCoverageResponseSchema>;

// ---------------------------------------------------------------------------
// VIP tiers.
// ---------------------------------------------------------------------------
export const VIP_TIERS = ['VIP', 'Gold', 'Silver', 'Standard'] as const;
export const VipTierSchema = z.enum(VIP_TIERS);
export type VipTier = z.infer<typeof VipTierSchema>;

// ---------------------------------------------------------------------------
// Ad performance (campaign/adset/ad rollups).
// ---------------------------------------------------------------------------
export const AdPerformanceRowSchema = z.object({
  entityType: AdEntityTypeSchema,
  entityId: z.string(),
  name: z.string(),
  spendMinor: z.number().int(),
  impressions: z.number().int(),
  clicks: z.number().int(),
  /** Meta-REPORTED conversions (see glossary — Meta over-reports). */
  conversions: z.number().int(),
  ctr: z.number(),
  cpcMinor: z.number().int(),
});
export type AdPerformanceRow = z.infer<typeof AdPerformanceRowSchema>;

export const AdPerformanceResponseSchema = z.object({ currency: z.string().nullable(), data: z.array(AdPerformanceRowSchema) });
export type AdPerformanceResponse = z.infer<typeof AdPerformanceResponseSchema>;

// ---------------------------------------------------------------------------
// Meta-vs-store reconciliation.
// ---------------------------------------------------------------------------
export const ReconciliationResponseSchema = z.object({
  metaReportedConversions: z.number().int(),
  storeActualOrders: z.number().int(),
  storeActualRevenueMinor: z.number().int(),
  currency: z.string().nullable(),
  /** Human note: Meta typically over-reports; revenue uses store-actual. */
  note: z.string(),
});
export type ReconciliationResponse = z.infer<typeof ReconciliationResponseSchema>;

// ---------------------------------------------------------------------------
// Audience sync (outbound — ConsentGate-gated).
// ---------------------------------------------------------------------------
export const AUDIENCE_TYPES = ['custom', 'suppression'] as const;
export const AudienceTypeSchema = z.enum(AUDIENCE_TYPES);
export type AudienceType = z.infer<typeof AudienceTypeSchema>;

export const SyncAudienceInput = z.object({
  segmentId: z.string().min(1),
  type: AudienceTypeSchema.default('custom'),
  /** Optional human name for the Meta audience. */
  name: z.string().max(200).optional(),
});
export type SyncAudienceInput = z.infer<typeof SyncAudienceInput>;

export const AudienceSyncSchema = z.object({
  id: z.string(),
  segmentId: z.string(),
  metaAudienceId: z.string().nullable(),
  type: AudienceTypeSchema,
  /** How many CONSENTED, non-suppressed customers were uploaded. */
  sizeSynced: z.number().int(),
  /** How many segment members were EXCLUDED by the ConsentGate. */
  excludedByConsent: z.number().int(),
  lastSyncedAt: z.string().nullable(),
});
export type AudienceSyncDto = z.infer<typeof AudienceSyncSchema>;

export const AudienceSyncListResponseSchema = z.object({ data: z.array(AudienceSyncSchema) });
export type AudienceSyncListResponse = z.infer<typeof AudienceSyncListResponseSchema>;
