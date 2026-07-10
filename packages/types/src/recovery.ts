import { z } from 'zod';

/** Human follow-up status for a recovery prospect (mirrors the Prisma enum). */
export const RECOVERY_STATUSES = ['to_contact', 'contacted', 'interested', 'no_response', 'converted', 'lost'] as const;
export const RecoveryStatusSchema = z.enum(RECOVERY_STATUSES);
export type RecoveryStatus = z.infer<typeof RecoveryStatusSchema>;

/** The two assignable prospect segments (buyers are never a segment). */
export const PROSPECT_SEGMENTS = ['cart_abandoner', 'non_buyer'] as const;
export const ProspectSegmentSchema = z.enum(PROSPECT_SEGMENTS);
export type ProspectSegment = z.infer<typeof ProspectSegmentSchema>;

export const ProspectSchema = z.object({
  customerId: z.string(),
  /** Name per policy, else "Customer #<id>". */
  displayName: z.string(),
  /** MASKED for non-admin roles (a•••@x.com). */
  email: z.string().nullable(),
  phone: z.string().nullable(),
  segment: ProspectSegmentSchema,
  /** What they left in the cart / last activity (null for non-buyers with no cart). */
  cartSummary: z.string().nullable(),
  valueAtRiskMinor: z.number().int(),
  daysSince: z.number().int().nullable(),
  ownerUserId: z.string().nullable(),
  status: RecoveryStatusSchema.nullable(),
  masked: z.boolean(),
});
export type Prospect = z.infer<typeof ProspectSchema>;

export const ProspectListResponseSchema = z.object({
  data: z.array(ProspectSchema),
  nextCursor: z.string().nullable(),
  /** Anonymous, non-identified sessions/carts — counted, NEVER assignable. */
  anonymousCount: z.number().int(),
});
export type ProspectListResponse = z.infer<typeof ProspectListResponseSchema>;

export const AssignProspectInput = z.object({
  customerIds: z.array(z.string().min(1)).min(1).max(500),
  /** Target owner; null unassigns. */
  toUserId: z.string().min(1).nullable(),
  reason: z.string().max(500).optional(),
});
export type AssignProspectInput = z.infer<typeof AssignProspectInput>;

export const LogProgressInput = z.object({
  customerId: z.string().min(1),
  status: RecoveryStatusSchema,
  note: z.string().max(2000).optional(),
});
export type LogProgressInput = z.infer<typeof LogProgressInput>;

export const ProgressUpdateSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  authorUserId: z.string(),
  status: RecoveryStatusSchema,
  /** PII-scrubbed before storage/AI. */
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type ProgressUpdateDto = z.infer<typeof ProgressUpdateSchema>;
export const ProgressListResponseSchema = z.object({ data: z.array(ProgressUpdateSchema) });
export type ProgressListResponse = z.infer<typeof ProgressListResponseSchema>;

export const CoordinationRowSchema = z.object({
  customerId: z.string(),
  displayName: z.string(),
  ownerUserId: z.string().nullable(),
  status: RecoveryStatusSchema.nullable(),
  lastUpdateAt: z.string().nullable(),
  lastNote: z.string().nullable(),
  masked: z.boolean(),
});
export const CoordinationResponseSchema = z.object({ data: z.array(CoordinationRowSchema) });
export type CoordinationResponse = z.infer<typeof CoordinationResponseSchema>;

export const RecoveryMetricSchema = z.object({
  ownerUserId: z.string(),
  assigned: z.number().int(),
  converted: z.number().int(),
  conversionRate: z.number(),
});
export const RecoveryMetricsResponseSchema = z.object({ data: z.array(RecoveryMetricSchema) });
export type RecoveryMetricsResponse = z.infer<typeof RecoveryMetricsResponseSchema>;

export const AssignResultSchema = z.object({ updated: z.number().int() });
export type AssignResult = z.infer<typeof AssignResultSchema>;
