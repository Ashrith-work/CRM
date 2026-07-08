import { z } from 'zod';

/**
 * Milestone 3 — RFM analytics + JSON rule-tree segmentation. Analytics are read
 * from the `customer_rfm` materialized view / denormalized CustomerFeatures;
 * endpoints never recompute inline. Money is integer minor units.
 */

// ---------------------------------------------------------------------------
// RFM.
// ---------------------------------------------------------------------------
/** Deterministic RFM segment labels (see the refresh worker's matrix). */
export const RFM_SEGMENTS = [
  'Champions',
  'Loyal',
  'Potential Loyalist',
  'New',
  'Promising',
  'Needs Attention',
  'At Risk',
  'About to Sleep',
  'Hibernating',
  'Lost',
] as const;
export const RfmSegmentSchema = z.enum(RFM_SEGMENTS);
export type RfmSegment = z.infer<typeof RfmSegmentSchema>;

export const RfmDistributionRowSchema = z.object({
  segment: z.string(),
  customers: z.number().int(),
  netRevenueMinor: z.number().int(),
});
export type RfmDistributionRow = z.infer<typeof RfmDistributionRowSchema>;

export const AnalyticsSummarySchema = z.object({
  /** Customers with at least one paid/fulfilled order (in RFM). */
  scoredCustomers: z.number().int(),
  totalCustomers: z.number().int(),
  netRevenueMinor: z.number().int(),
  aovMinor: z.number().int(),
  currency: z.string().nullable(),
  lastRefreshedAt: z.string().nullable(),
  distribution: z.array(RfmDistributionRowSchema),
});
export type AnalyticsSummary = z.infer<typeof AnalyticsSummarySchema>;

// ---------------------------------------------------------------------------
// Segment rule tree (whitelisted fields + ops; translated to a SAFE query).
// ---------------------------------------------------------------------------
export const SEGMENT_FIELDS = [
  'rSegment',
  'daysSinceLast',
  'totalOrders',
  'netRevenueMinor',
  'aovMinor',
  'clvBand',
  'rScore',
  'fScore',
  'mScore',
] as const;
export const SegmentFieldSchema = z.enum(SEGMENT_FIELDS);
export type SegmentField = z.infer<typeof SegmentFieldSchema>;

export const RULE_OPS = ['eq', 'in', 'gt', 'gte', 'lt', 'lte'] as const;
export const RuleOpSchema = z.enum(RULE_OPS);
export type RuleOp = z.infer<typeof RuleOpSchema>;

export const RuleValueSchema = z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]);

export const RuleLeafSchema = z.object({
  field: SegmentFieldSchema,
  op: RuleOpSchema,
  value: RuleValueSchema,
});
export type RuleLeaf = z.infer<typeof RuleLeafSchema>;

export interface RuleGroup {
  op: 'AND' | 'OR';
  rules: Array<RuleLeaf | RuleGroup>;
}
export const RuleGroupSchema: z.ZodType<RuleGroup> = z.lazy(() =>
  z.object({
    op: z.enum(['AND', 'OR']),
    rules: z.array(z.union([RuleLeafSchema, RuleGroupSchema])).min(1).max(50),
  }),
);
export type RuleTree = RuleGroup;

// ---------------------------------------------------------------------------
// Segment endpoints.
// ---------------------------------------------------------------------------
export const SegmentSampleRowSchema = z.object({
  customerId: z.string(),
  name: z.string(),
  email: z.string().nullable(), // masked per role
  netRevenueMinor: z.number().int(),
  rSegment: z.string().nullable(),
});
export type SegmentSampleRow = z.infer<typeof SegmentSampleRowSchema>;

export const SegmentPreviewInput = z.object({ rules: RuleGroupSchema });
export type SegmentPreviewInput = z.infer<typeof SegmentPreviewInput>;

export const SegmentPreviewResponseSchema = z.object({
  count: z.number().int(),
  sample: z.array(SegmentSampleRowSchema),
});
export type SegmentPreviewResponse = z.infer<typeof SegmentPreviewResponseSchema>;

export const SegmentTypeSchema = z.enum(['STATIC', 'DYNAMIC']);
export type SegmentTypeDto = z.infer<typeof SegmentTypeSchema>;

export const SaveSegmentInput = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(1000).optional(),
    rules: RuleGroupSchema,
    type: SegmentTypeSchema.optional().default('STATIC'),
    refreshCron: z.string().max(120).optional(),
  })
  .refine((v) => v.type !== 'DYNAMIC' || !!v.refreshCron, {
    message: 'dynamic segments require a refreshCron',
    path: ['refreshCron'],
  });
export type SaveSegmentInput = z.infer<typeof SaveSegmentInput>;

export const SegmentSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  rules: z.unknown(),
  type: SegmentTypeSchema,
  refreshCron: z.string().nullable(),
  memberCount: z.number().int(),
  lastRefreshedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Segment = z.infer<typeof SegmentSchema>;

export const SegmentListResponseSchema = z.object({ data: z.array(SegmentSchema) });
export type SegmentListResponse = z.infer<typeof SegmentListResponseSchema>;

export const SegmentMembersResponseSchema = z.object({
  data: z.array(SegmentSampleRowSchema),
  nextCursor: z.string().nullable(),
});
export type SegmentMembersResponse = z.infer<typeof SegmentMembersResponseSchema>;
