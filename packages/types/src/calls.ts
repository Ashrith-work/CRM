import { z } from 'zod';
import { ActorSchema, SortOrderSchema } from './crm';

/**
 * Milestone 5 — call management (MyOperator telephony + Cloudinary recordings +
 * DPDP consent). Capture & storage only — NO transcription/AI (that is M6).
 * All datetimes are UTC ISO strings; durations are integer seconds.
 */

// ---------------------------------------------------------------------------
// Enums (in lock-step with the Prisma enums of the same name).
// ---------------------------------------------------------------------------
export const CALL_DIRECTIONS = ['INBOUND', 'OUTBOUND'] as const;
export const CallDirectionSchema = z.enum(CALL_DIRECTIONS);
export type CallDirection = z.infer<typeof CallDirectionSchema>;

export const CALL_STATUSES = ['RINGING', 'IN_PROGRESS', 'COMPLETED', 'MISSED', 'FAILED', 'NO_ANSWER'] as const;
export const CallStatusSchema = z.enum(CALL_STATUSES);
export type CallStatus = z.infer<typeof CallStatusSchema>;

export const RECORDING_STATUSES = ['NONE', 'PENDING', 'STORED', 'BLOCKED', 'FAILED'] as const;
export const RecordingStatusSchema = z.enum(RECORDING_STATUSES);
export type RecordingStatus = z.infer<typeof RecordingStatusSchema>;

export const CONSENT_PURPOSES = ['CALL_RECORDING', 'MARKETING'] as const;
export const ConsentPurposeSchema = z.enum(CONSENT_PURPOSES);
export type ConsentPurpose = z.infer<typeof ConsentPurposeSchema>;

export const CONSENT_STATUSES = ['GRANTED', 'WITHDRAWN', 'NOT_CAPTURED'] as const;
export const ConsentStatusSchema = z.enum(CONSENT_STATUSES);
export type ConsentStatus = z.infer<typeof ConsentStatusSchema>;

export const CONSENT_SOURCES = ['IVR_DISCLOSURE', 'EXPLICIT', 'SHOPIFY'] as const;
export const ConsentSourceSchema = z.enum(CONSENT_SOURCES);
export type ConsentSource = z.infer<typeof ConsentSourceSchema>;

// ---------------------------------------------------------------------------
// Shared refs.
// ---------------------------------------------------------------------------
export const CallContactRefSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string().nullable(),
});
export type CallContactRef = z.infer<typeof CallContactRefSchema>;

export const CallDealRefSchema = z.object({ id: z.string(), name: z.string() });
export type CallDealRef = z.infer<typeof CallDealRefSchema>;

// ---------------------------------------------------------------------------
// Call.
// ---------------------------------------------------------------------------
export const CallSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  direction: CallDirectionSchema,
  fromNumber: z.string(),
  toNumber: z.string(),
  agentUserId: z.string().nullable(),
  agent: ActorSchema.nullable(),
  contactId: z.string().nullable(),
  contact: CallContactRefSchema.nullable(),
  dealId: z.string().nullable(),
  deal: CallDealRefSchema.nullable(),
  status: CallStatusSchema,
  startedAt: z.string().nullable(),
  answeredAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  durationSeconds: z.number().int().nullable(),
  disposition: z.string().nullable(),
  notes: z.string().nullable(),
  externalCallId: z.string().nullable(),
  recordingStatus: RecordingStatusSchema,
  /** True only when a recording is STORED (playable via the signed-url endpoint). */
  recordingAvailable: z.boolean(),
  /** The matched contact's CALL_RECORDING consent status, for a badge. */
  consentStatus: ConsentStatusSchema.nullable(),
  /** True if this number matched more than one contact (picked most-recent). */
  ambiguousMatch: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Call = z.infer<typeof CallSchema>;

/** Initiate an outbound click-to-call (connect agent ↔ contact via MyOperator). */
export const ClickToCallInput = z.object({
  contactId: z.string().min(1),
  dealId: z.string().optional().nullable(),
  /** Override the number to dial; defaults to the contact's phone. */
  toNumber: z.string().optional(),
});
export type ClickToCallInput = z.infer<typeof ClickToCallInput>;

/** Manually log a call that happened outside click-to-call (mobile "log a call"). */
export const LogCallInput = z
  .object({
    direction: CallDirectionSchema,
    contactId: z.string().optional().nullable(),
    fromNumber: z.string().optional(),
    toNumber: z.string().optional(),
    status: CallStatusSchema.optional().default('COMPLETED'),
    startedAt: z.string().datetime({ offset: true }).optional(),
    durationSeconds: z.number().int().min(0).optional(),
    disposition: z.string().max(120).optional(),
    notes: z.string().max(10_000).optional(),
    dealId: z.string().optional().nullable(),
  })
  .refine((v) => v.contactId || v.toNumber || v.fromNumber, {
    message: 'Provide a contactId or at least one phone number',
    path: ['contactId'],
  });
export type LogCallInput = z.infer<typeof LogCallInput>;

export const UpdateCallInput = z.object({
  disposition: z.string().max(120).nullable().optional(),
  notes: z.string().max(10_000).nullable().optional(),
  dealId: z.string().nullable().optional(),
});
export type UpdateCallInput = z.infer<typeof UpdateCallInput>;

export const CallListQueryInput = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  search: z.string().optional(),
  order: SortOrderSchema.optional().default('desc'),
  contactId: z.string().optional(),
  dealId: z.string().optional(),
  /** 'me' resolves to the current agent. */
  agentUserId: z.string().optional(),
  direction: CallDirectionSchema.optional(),
  status: CallStatusSchema.optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});
export type CallListQueryInput = z.infer<typeof CallListQueryInput>;

export const CallListResponseSchema = z.object({
  data: z.array(CallSchema),
  nextCursor: z.string().nullable(),
});
export type CallListResponse = z.infer<typeof CallListResponseSchema>;

/** Response of GET /calls/:id/recording — a short-lived signed URL when allowed. */
export const RecordingUrlResponseSchema = z.object({
  status: RecordingStatusSchema,
  url: z.string().nullable(),
  expiresAt: z.string().nullable(),
  /** Present when url is null (e.g. "consent not granted", "not stored yet"). */
  reason: z.string().nullable(),
});
export type RecordingUrlResponse = z.infer<typeof RecordingUrlResponseSchema>;

// ---------------------------------------------------------------------------
// Consent.
// ---------------------------------------------------------------------------
export const ConsentSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  contactId: z.string().nullable(),
  customerId: z.string().nullable(),
  purpose: ConsentPurposeSchema,
  status: ConsentStatusSchema,
  source: ConsentSourceSchema.nullable(),
  grantedAt: z.string().nullable(),
  withdrawnAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Consent = z.infer<typeof ConsentSchema>;

export const SetConsentInput = z.object({
  contactId: z.string().min(1),
  purpose: ConsentPurposeSchema.optional().default('CALL_RECORDING'),
  status: z.enum(['GRANTED', 'WITHDRAWN']),
  source: ConsentSourceSchema.optional(),
});
export type SetConsentInput = z.infer<typeof SetConsentInput>;

export const ConsentListResponseSchema = z.object({ data: z.array(ConsentSchema) });
export type ConsentListResponse = z.infer<typeof ConsentListResponseSchema>;

// ---------------------------------------------------------------------------
// MyOperator webhook payload (external shape — validated loosely).
// ---------------------------------------------------------------------------
export const MyOperatorWebhookSchema = z
  .object({
    /** MyOperator's unique call id — the idempotency key. */
    call_id: z.string().optional(),
    uuid: z.string().optional(),
    company_id: z.string().optional(),
    event: z.string().optional(),
    status: z.string().optional(),
    direction: z.string().optional(),
    caller_number: z.string().optional(),
    receiver_number: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    agent_number: z.string().optional(),
    start_time: z.string().optional(),
    answer_time: z.string().optional(),
    end_time: z.string().optional(),
    duration: z.union([z.string(), z.number()]).optional(),
    recording_url: z.string().optional(),
  })
  .passthrough();
export type MyOperatorWebhook = z.infer<typeof MyOperatorWebhookSchema>;
