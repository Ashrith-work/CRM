import { z } from 'zod';

/**
 * Purchase Analysis Dashboard — look up a customer (phone / email / name
 * typeahead) and show their last + 2nd-last order, plus human escalation notes.
 * Reads existing Customer/Order/OrderItem/Product/CustomerFeatures; the only new
 * dataset is EscalationSummary. Money is integer minor units; rates are [0,1].
 * All PII is masked unless the caller has pii:read.
 */

// ---------------------------------------------------------------------------
// Lookup + typeahead.
// ---------------------------------------------------------------------------
export const CustomerSuggestionSchema = z.object({
  id: z.string(),
  /** Display name (masked per role when it is an email fallback). */
  name: z.string(),
  /** Masked email (or null) to disambiguate identically-named customers. */
  email: z.string().nullable(),
  externalId: z.string().nullable(),
  orderCount: z.number().int(),
});
export type CustomerSuggestion = z.infer<typeof CustomerSuggestionSchema>;

export const SuggestQueryInput = z.object({
  q: z.string().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(20).optional().default(8),
});
export type SuggestQueryInput = z.infer<typeof SuggestQueryInput>;

export const SuggestResponseSchema = z.object({ data: z.array(CustomerSuggestionSchema) });
export type SuggestResponse = z.infer<typeof SuggestResponseSchema>;

export const LookupQueryInput = z.object({ q: z.string().min(1).max(160) });
export type LookupQueryInput = z.infer<typeof LookupQueryInput>;

/** Exactly one of `match` (resolved) or `candidates` (disambiguate) is meaningful. */
export const LookupResponseSchema = z.object({
  /** The matched field type — helps the UI explain how it resolved. */
  matchedBy: z.enum(['email', 'phone', 'name', 'none']),
  match: CustomerSuggestionSchema.nullable(),
  candidates: z.array(CustomerSuggestionSchema),
});
export type LookupResponse = z.infer<typeof LookupResponseSchema>;

// ---------------------------------------------------------------------------
// Purchase profile (last + 2nd-last order).
// ---------------------------------------------------------------------------
export const OrderProductSchema = z.object({ title: z.string(), variant: z.string().nullable() });
export type OrderProduct = z.infer<typeof OrderProductSchema>;

export const OrderDiscountSchema = z.object({
  code: z.string().nullable(),
  amountMinor: z.number().int(),
  /** Discount ÷ pre-discount subtotal, as a [0,1] fraction. null when subtotal is 0. */
  pct: z.number().nullable(),
});
export type OrderDiscount = z.infer<typeof OrderDiscountSchema>;

export const PurchaseOrderRowSchema = z.object({
  orderId: z.string(),
  orderNumber: z.string().nullable(),
  placedAt: z.string(),
  /** RFM segment (CustomerFeatures.rSegment) at read time. */
  segment: z.string().nullable(),
  /** Reserved: Shopify POS location → store label. BLANK for now. */
  mode: z.null(),
  /** Net order value (totalMinor − refundedMinor). */
  valueMinor: z.number().int(),
  currency: z.string(),
  /** null ⇒ "No discount". */
  discount: OrderDiscountSchema.nullable(),
  /** Fabric labels from the products' Shopify tags; empty ⇒ show "-", never fabricated. */
  fabrics: z.array(z.string()),
  /** Line-item product types/categories. */
  productTypes: z.array(z.string()),
  products: z.array(OrderProductSchema),
});
export type PurchaseOrderRow = z.infer<typeof PurchaseOrderRowSchema>;

export const PurchaseCustomerSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  externalId: z.string().nullable(),
  totalOrders: z.number().int(),
  netRevenueMinor: z.number().int(),
  currency: z.string().nullable(),
  segment: z.string().nullable(),
  clvMinor: z.number().int().nullable(),
  clvBand: z.string().nullable(),
  lastOrderAt: z.string().nullable(),
  masked: z.boolean(),
});
export type PurchaseCustomer = z.infer<typeof PurchaseCustomerSchema>;

export const PurchaseProfileSchema = z.object({
  customer: PurchaseCustomerSchema,
  /** Newest first: [last, 2nd-last] — 0, 1, or 2 entries. */
  orders: z.array(PurchaseOrderRowSchema),
});
export type PurchaseProfile = z.infer<typeof PurchaseProfileSchema>;

// ---------------------------------------------------------------------------
// Escalation summaries (the one new dataset).
// ---------------------------------------------------------------------------
export const ESCALATION_STATUSES = ['OPEN', 'RESOLVED'] as const;
export const EscalationStatusSchema = z.enum(ESCALATION_STATUSES);
export type EscalationStatus = z.infer<typeof EscalationStatusSchema>;

export const EscalationSummaryDtoSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  orderId: z.string().nullable(),
  note: z.string(),
  status: EscalationStatusSchema.nullable(),
  authorUserId: z.string(),
  authorName: z.string().nullable(),
  createdAt: z.string(),
});
export type EscalationSummaryDto = z.infer<typeof EscalationSummaryDtoSchema>;

export const AddEscalationInput = z.object({
  note: z.string().min(1).max(4000),
  status: EscalationStatusSchema.optional(),
  orderId: z.string().max(64).optional(),
});
export type AddEscalationInput = z.infer<typeof AddEscalationInput>;

export const EscalationListResponseSchema = z.object({ data: z.array(EscalationSummaryDtoSchema) });
export type EscalationListResponse = z.infer<typeof EscalationListResponseSchema>;
