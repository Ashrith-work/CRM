import { z } from 'zod';

/**
 * Append-only loyalty ledger. Balance is ALWAYS SUM(delta) — there is no mutable
 * balance field. Earn (+) on paid orders, burn (−) on redemption, negative
 * CLAWBACK on refund. Money/points are integers.
 */

export const LOYALTY_REASONS = ['EARN', 'BURN', 'CLAWBACK', 'ADJUST'] as const;
export const LoyaltyReasonSchema = z.enum(LOYALTY_REASONS);
export type LoyaltyReason = z.infer<typeof LoyaltyReasonSchema>;

export const LoyaltyTransactionSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  delta: z.number().int(),
  reason: LoyaltyReasonSchema,
  refOrderId: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type LoyaltyTransaction = z.infer<typeof LoyaltyTransactionSchema>;

export const LoyaltyBalanceResponseSchema = z.object({
  customerId: z.string(),
  /** SUM(delta) — the single source of truth. */
  balance: z.number().int(),
  earned: z.number().int(),
  burned: z.number().int(),
});
export type LoyaltyBalanceResponse = z.infer<typeof LoyaltyBalanceResponseSchema>;

export const LoyaltyLedgerResponseSchema = z.object({
  balance: z.number().int(),
  data: z.array(LoyaltyTransactionSchema),
});
export type LoyaltyLedgerResponse = z.infer<typeof LoyaltyLedgerResponseSchema>;

/** Manual point burn (redeem). Fails if it would drive the balance negative. */
export const RedeemPointsInput = z.object({
  points: z.number().int().positive(),
  note: z.string().max(200).optional(),
});
export type RedeemPointsInput = z.infer<typeof RedeemPointsInput>;
