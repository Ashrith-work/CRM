import { z } from 'zod';
import { ConsentStatusSchema } from './calls';

/**
 * Milestone 2 — Customer 360 contracts: a filterable unified timeline, a
 * recent-orders panel with a range control, denormalized metric badges, and the
 * multi-tab Excel export. Money stays integer minor units; PII is masked per role.
 */

// ---------------------------------------------------------------------------
// Metric badges (placeholders until M3) + identity.
// ---------------------------------------------------------------------------
export const CustomerBadgesSchema = z.object({
  /** RFM segment label (e.g. "Champions"); real from M3. */
  rfm: z.string().nullable(),
  rScore: z.number().int().nullable(),
  fScore: z.number().int().nullable(),
  mScore: z.number().int().nullable(),
  daysSinceLast: z.number().int().nullable(),
  clv: z.number().int().nullable(), // minor units (real — historical CLV)
  clvBand: z.string().nullable(), // High | Mid | Low
  churnRisk: z.number().nullable(), // 0..1 heuristic score
  churnBand: z.string().nullable(), // Low | Medium | High | Unknown
  /** VIP | Gold | Silver | Standard — assigned by the tier worker. */
  vipTier: z.string().nullable(),
  apparelSize: z.string().nullable(),
  fit: z.string().nullable(),
  styleAffinity: z.string().nullable(),
});
export type CustomerBadges = z.infer<typeof CustomerBadgesSchema>;

export const CustomerFeaturesSummarySchema = z.object({
  netRevenueMinor: z.number().int(),
  orderCount: z.number().int(),
  avgOrderValueMinor: z.number().int(),
  firstOrderAt: z.string().nullable(),
  lastOrderAt: z.string().nullable(),
  currency: z.string().nullable(),
  badges: CustomerBadgesSchema,
});
export type CustomerFeaturesSummary = z.infer<typeof CustomerFeaturesSummarySchema>;

export const ConsentBadgeSchema = z.object({
  purpose: z.enum(['marketing', 'call_recording']),
  status: ConsentStatusSchema, // GRANTED | WITHDRAWN | NOT_CAPTURED
});
export type ConsentBadge = z.infer<typeof ConsentBadgeSchema>;

export const Customer360Schema = z.object({
  id: z.string(),
  externalId: z.string().nullable(),
  /** Masked (e.g. j•••@n•••.co) unless the caller has pii:read. */
  email: z.string().nullable(),
  phone: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  mergedIntoId: z.string().nullable(),
  masked: z.boolean(),
  consents: z.array(ConsentBadgeSchema),
  features: CustomerFeaturesSummarySchema,
});
export type Customer360 = z.infer<typeof Customer360Schema>;

// ---------------------------------------------------------------------------
// Unified timeline.
// ---------------------------------------------------------------------------
export const INTERACTION_TYPES = ['order', 'event', 'message', 'call', 'ticket', 'note', 'return', 'lead'] as const;
export const InteractionTypeSchema = z.enum(INTERACTION_TYPES);
export type InteractionType = z.infer<typeof InteractionTypeSchema>;

export const TimelineItemSchema = z.object({
  id: z.string(),
  type: InteractionTypeSchema,
  refId: z.string(),
  summary: z.string().nullable(),
  occurredAt: z.string(),
});
export type TimelineItem = z.infer<typeof TimelineItemSchema>;

export const TimelineQueryInput = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  type: InteractionTypeSchema.optional(),
});
export type TimelineQueryInput = z.infer<typeof TimelineQueryInput>;

export const TimelineResponseSchema = z.object({ data: z.array(TimelineItemSchema), nextCursor: z.string().nullable() });
export type TimelineResponse = z.infer<typeof TimelineResponseSchema>;

// ---------------------------------------------------------------------------
// Recent orders panel + range control.
// ---------------------------------------------------------------------------
export const RecentOrderSchema = z.object({
  id: z.string(),
  orderNumber: z.string().nullable(),
  placedAt: z.string(),
  /** "Mon YYYY" e.g. "Jun 2026". */
  monthLabel: z.string(),
  status: z.string(),
  financialStatus: z.string(),
  /** totalMinor − refundedMinor. */
  netMinor: z.number().int(),
  currency: z.string(),
  itemsSummary: z.string(),
  discountCode: z.string().nullable(),
  discountMinor: z.number().int(),
});
export type RecentOrder = z.infer<typeof RecentOrderSchema>;

/** Range control: last-N (default 3), all, custom from–to, or a year/month. */
export const RecentOrdersQueryInput = z.object({
  limit: z.coerce.number().int().min(0).max(500).optional().default(3), // 0 = all
  from: z.string().optional(),
  to: z.string().optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});
export type RecentOrdersQueryInput = z.infer<typeof RecentOrdersQueryInput>;

export const RecentOrdersResponseSchema = z.object({ data: z.array(RecentOrderSchema) });
export type RecentOrdersResponse = z.infer<typeof RecentOrdersResponseSchema>;

// ---------------------------------------------------------------------------
// Customer list.
// ---------------------------------------------------------------------------
export const CustomerListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(), // masked per role
  orderCount: z.number().int(),
  netRevenueMinor: z.number().int(),
  currency: z.string().nullable(),
  lastOrderAt: z.string().nullable(),
});
export type CustomerListItem = z.infer<typeof CustomerListItemSchema>;

export const CustomerListQueryInput = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  search: z.string().optional(),
  sort: z.string().optional(), // netRevenueMinor | orderCount | lastOrderAt
  order: z.enum(['asc', 'desc']).optional().default('desc'),
});
export type CustomerListQueryInput = z.infer<typeof CustomerListQueryInput>;

export const CustomerListResponseSchema = z.object({ data: z.array(CustomerListItemSchema), nextCursor: z.string().nullable() });
export type CustomerListResponse = z.infer<typeof CustomerListResponseSchema>;

// ---------------------------------------------------------------------------
// Experience export.
// ---------------------------------------------------------------------------
export const ExportAsyncResponseSchema = z.object({ jobId: z.string() });
export type ExportAsyncResponse = z.infer<typeof ExportAsyncResponseSchema>;

export const ExportStatusResponseSchema = z.object({
  state: z.enum(['queued', 'running', 'completed', 'failed']),
  ready: z.boolean(),
  filename: z.string().nullable(),
  error: z.string().nullable(),
});
export type ExportStatusResponse = z.infer<typeof ExportStatusResponseSchema>;

/** The 8 Customer-Experience workbook tabs (fixed order). */
export const EXPERIENCE_EXPORT_TABS = [
  'Summary',
  'Orders',
  'Discounts & Incentives',
  'Support & Calls',
  'Campaigns & Messages',
  'Behaviour & Attribution',
  'Returns',
  'Loyalty',
] as const;
