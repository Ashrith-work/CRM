import { z } from 'zod';

/**
 * Threshold incentive engine. Per Part 9, the numbers are stated before storing:
 * the discount VALUE is capped (maxValueMinor, not just a %), low-margin SKUs are
 * excluded, a minimum next-order value is set, and a validity window bounds it.
 * "X products" is defined PRECISELY by the trigger metric.
 */

export const DISCOUNT_TYPES = ['PERCENT', 'FIXED_AMOUNT'] as const;
export const DiscountTypeSchema = z.enum(DISCOUNT_TYPES);
export type DiscountType = z.infer<typeof DiscountTypeSchema>;

export const INCENTIVE_STATUSES = ['ACTIVE', 'REDEEMED', 'EXPIRED'] as const;
export const IncentiveStatusSchema = z.enum(INCENTIVE_STATUSES);
export type IncentiveStatus = z.infer<typeof IncentiveStatusSchema>;

/**
 * The PRECISE definition of "X products":
 *  - units        → total item quantity across paid/fulfilled orders (DEFAULT)
 *  - orders       → count of paid/fulfilled orders
 *  - distinct_skus→ number of distinct products purchased
 */
export const TRIGGER_METRICS = ['units', 'orders', 'distinct_skus'] as const;
export const TriggerMetricSchema = z.enum(TRIGGER_METRICS);
export type TriggerMetric = z.infer<typeof TriggerMetricSchema>;

export const TriggerRuleSchema = z.object({
  metric: TriggerMetricSchema,
  threshold: z.number().int().positive(),
  /** Optional rolling window in days; omitted = lifetime. */
  windowDays: z.number().int().positive().optional(),
});
export type TriggerRule = z.infer<typeof TriggerRuleSchema>;

export const IncentiveSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  triggerRule: TriggerRuleSchema,
  discountType: DiscountTypeSchema,
  discountValueMinor: z.number().int().nullable(),
  discountPercent: z.number().int().nullable(),
  /** The VALUE cap (paise) — the discount can never exceed this. */
  maxValueMinor: z.number().int(),
  minNextOrderMinor: z.number().int(),
  /** { productExternalIds: string[] } — low-margin SKUs excluded from the code. */
  excludedSkuRule: z.object({ productExternalIds: z.array(z.string()) }).nullable(),
  pointsCost: z.number().int(),
  /** Whether the margin guard was ON at issuance (honest exposure audit). */
  marginGuard: z.boolean(),
  discountCode: z.string().nullable(),
  validFrom: z.string(),
  validUntil: z.string(),
  status: IncentiveStatusSchema,
  sourceOrderId: z.string().nullable(),
  redeemedOrderId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Incentive = z.infer<typeof IncentiveSchema>;

export const IncentiveListResponseSchema = z.object({ data: z.array(IncentiveSchema) });
export type IncentiveListResponse = z.infer<typeof IncentiveListResponseSchema>;

/** Manually (re-)evaluate a customer for a threshold incentive (admin/testing). */
export const EvaluateIncentiveInput = z.object({ customerId: z.string().min(1) });
export type EvaluateIncentiveInput = z.infer<typeof EvaluateIncentiveInput>;

/** The margin-guard state the UI shows honestly (never pretend it's on). */
export const IncentiveConfigResponseSchema = z.object({
  marginGuard: z.boolean(),
  marginFloorPct: z.number(),
  trigger: TriggerRuleSchema,
  maxValueMinor: z.number().int(),
  minNextOrderMinor: z.number().int(),
});
export type IncentiveConfigResponse = z.infer<typeof IncentiveConfigResponseSchema>;
