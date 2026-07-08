import { z } from 'zod';

/**
 * Milestone 4 — abandoned-cart recovery (the closed loop). Consent-gated email
 * sequence that halts on purchase, plus recovery-rate stats. Money is integer
 * minor units (paise); times are UTC ISO strings.
 */

export const MESSAGE_CHANNELS = ['EMAIL'] as const;
export const MessageChannelSchema = z.enum(MESSAGE_CHANNELS);
export type MessageChannel = z.infer<typeof MessageChannelSchema>;

export const CAMPAIGN_SEND_STATUSES = ['QUEUED', 'SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'BOUNCED', 'BLOCKED', 'FAILED', 'DELAYED'] as const;
export const CampaignSendStatusSchema = z.enum(CAMPAIGN_SEND_STATUSES);
export type CampaignSendStatus = z.infer<typeof CampaignSendStatusSchema>;

export const ENROLLMENT_STATUSES = ['ACTIVE', 'CONVERTED', 'HALTED', 'COMPLETED'] as const;
export const EnrollmentStatusSchema = z.enum(ENROLLMENT_STATUSES);
export type EnrollmentStatus = z.infer<typeof EnrollmentStatusSchema>;

export const SUPPRESSION_REASONS = ['UNSUBSCRIBE', 'BOUNCE', 'COMPLAINT', 'MANUAL'] as const;
export const SuppressionReasonSchema = z.enum(SUPPRESSION_REASONS);
export type SuppressionReason = z.infer<typeof SuppressionReasonSchema>;

export const CampaignStepSchema = z.object({
  id: z.string(),
  stepOrder: z.number().int(),
  delayMinutes: z.number().int(),
  templateId: z.string(),
  templateKey: z.string(),
  templateVersion: z.number().int(),
  subject: z.string(),
});
export type CampaignStep = z.infer<typeof CampaignStepSchema>;

export const CampaignSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.literal('ABANDONED_CART'),
  status: z.enum(['ACTIVE', 'PAUSED']),
  channel: MessageChannelSchema,
  attributionWindowMinutes: z.number().int(),
  steps: z.array(CampaignStepSchema),
  enrollmentCount: z.number().int(),
  activeCount: z.number().int(),
  sentCount: z.number().int(),
  recoveredCount: z.number().int(),
  createdAt: z.string(),
});
export type Campaign = z.infer<typeof CampaignSchema>;

export const CampaignListResponseSchema = z.object({ data: z.array(CampaignSchema) });
export type CampaignListResponse = z.infer<typeof CampaignListResponseSchema>;

export const CampaignSendSchema = z.object({
  id: z.string(),
  stepOrder: z.number().int(),
  channel: MessageChannelSchema,
  templateVersion: z.number().int(),
  status: CampaignSendStatusSchema,
  blockedReason: z.string().nullable(),
  sentAt: z.string().nullable(),
  outcomeAt: z.string().nullable(),
});
export type CampaignSend = z.infer<typeof CampaignSendSchema>;

export const EnrollmentSchema = z.object({
  id: z.string(),
  email: z.string().nullable(), // masked per role
  status: EnrollmentStatusSchema,
  checkoutStartedAt: z.string(),
  enrolledAt: z.string(),
  convertedAt: z.string().nullable(),
  haltReason: z.string().nullable(),
  sends: z.array(CampaignSendSchema),
});
export type Enrollment = z.infer<typeof EnrollmentSchema>;

export const EnrollmentListResponseSchema = z.object({ data: z.array(EnrollmentSchema), nextCursor: z.string().nullable() });
export type EnrollmentListResponse = z.infer<typeof EnrollmentListResponseSchema>;

/**
 * Recovery stats — the MVP metric tile.
 *   recoveryRate = recoveredCarts ÷ abandonedCarts
 *   recovered = enrolled cart whose customer placed a qualifying order after
 *   enrollment within the attribution window; recoveredRevenue = net of those.
 */
export const RecoveryStatsSchema = z.object({
  abandonedCarts: z.number().int(),
  recoveredCarts: z.number().int(),
  recoveryRate: z.number(), // 0..1
  recoveredRevenueMinor: z.number().int(),
  currency: z.string().nullable(),
  sends: z.object({
    total: z.number().int(),
    sent: z.number().int(),
    blocked: z.number().int(),
    bounced: z.number().int(),
    opened: z.number().int(),
    clicked: z.number().int(),
    delayed: z.number().int(),
  }),
  lastRefreshedAt: z.string().nullable(),
});
export type RecoveryStats = z.infer<typeof RecoveryStatsSchema>;
