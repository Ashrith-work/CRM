import { z } from 'zod';
import { RuleGroupSchema } from './analytics';

/**
 * P2.2 — the read-only AI assistant. A natural-language question is answered
 * ONLY from org data, via a curated safe read-only query layer over the
 * analytics views + CustomerFeatures, grounded in the ONE glossary (every
 * metric cites its definition). The assistant inherits the asker's RBAC role,
 * NEVER acts, is cached + cost-bounded, and audits every question.
 *
 * These are the WIRE shapes only. The tool layer, orchestrator, grounding, and
 * caching all live server-side (apps/api/src/assistant); the model never sees
 * these schemas.
 */

// ---------------------------------------------------------------------------
// Request.
// ---------------------------------------------------------------------------
export const AssistantAskInput = z.object({
  /** The user's natural-language question. Bounded so a prompt can't be huge. */
  question: z.string().min(1).max(1000),
});
export type AssistantAskInput = z.infer<typeof AssistantAskInput>;

// ---------------------------------------------------------------------------
// The PII boundary — the ONLY customer shape the AI (and external payloads) see.
// customer_id + pseudonym + non-identifying fields. NO raw name/email/phone: the
// type physically cannot carry them, so no prompt/payload builder can read them.
// ---------------------------------------------------------------------------
export const SafeCustomerSchema = z.object({
  customerId: z.string(),
  /** e.g. "Customer #8a2f10" — a stable label the AI reasons about. */
  pseudonym: z.string(),
  /** Non-identifying: the email DOMAIN only (e.g. "gmail.com"), never the address. */
  emailDomain: z.string().nullable(),
  rfmSegment: z.string().nullable(),
  clvBand: z.string().nullable(),
  churnBand: z.string().nullable(),
  vipTier: z.string().nullable(),
  orderCount: z.number().int(),
  netRevenueMinor: z.number().int(),
});
export type SafeCustomer = z.infer<typeof SafeCustomerSchema>;

// ---------------------------------------------------------------------------
// Citations — every metric named in an answer resolves from the glossary.
// ---------------------------------------------------------------------------
export const AssistantCitationSchema = z.object({
  metricKey: z.string(),
  plainLanguage: z.string(),
  formula: z.string(),
  dataWindow: z.string(),
});
export type AssistantCitation = z.infer<typeof AssistantCitationSchema>;

/** Which safe tool ran, and how many rows it touched (for the "what backed this" trail). */
export const AssistantToolTraceSchema = z.object({
  tool: z.string(),
  /** Sanitized args echoed back (never raw SQL — there is no SQL). */
  args: z.record(z.unknown()),
  rowCount: z.number().int().nullable(),
});
export type AssistantToolTrace = z.infer<typeof AssistantToolTraceSchema>;

/**
 * Optional "build segment from this" hand-off. The assistant NEVER acts, so
 * when a question implies a segment it emits a validated rule tree the USER
 * then acts on (M3's engine) — the assistant does not create the segment.
 */
export const AssistantSegmentHandoffSchema = z.object({
  label: z.string(),
  rules: RuleGroupSchema,
});
export type AssistantSegmentHandoff = z.infer<typeof AssistantSegmentHandoffSchema>;

// ---------------------------------------------------------------------------
// Response.
// ---------------------------------------------------------------------------
export const AssistantAnswerSchema = z.object({
  /** The grounded natural-language answer. */
  answer: z.string(),
  /** Glossary definitions backing every metric named in the answer. */
  citations: z.array(AssistantCitationSchema),
  /** The safe read-only tools that produced the data behind the answer. */
  toolsUsed: z.array(AssistantToolTraceSchema),
  /** Present when the question implies a segment the user could build (hand-off). */
  segmentHandoff: AssistantSegmentHandoffSchema.nullable(),
  /**
   * True when the asker requested an ACTION ("email this segment", "delete X").
   * The assistant can't act, so it explains that instead — this flags the UI.
   */
  declinedAction: z.boolean(),
  /** True when this answer was served from the short-TTL cache. */
  cached: z.boolean(),
  /** ISO timestamp the answer was produced. */
  answeredAt: z.string(),
});
export type AssistantAnswer = z.infer<typeof AssistantAnswerSchema>;
