import type { FinancialStatus, OrderStatus } from '@crm/types';
import { parseMinor } from '../common/money.util';
import { normalizeE164 } from '../common/phone.util';
import { extractShopifyAttribution, type OrderAttributes } from '../attribution/utm.util';

/**
 * Shopify → CRM field mappers. PURE and shared by BOTH the backfill worker and
 * the webhook processor, so historical and live data map identically. Money is
 * parsed from strings into integer minor units; times are UTC Date objects;
 * email/phone are normalized here.
 */

// Loose provider shapes (REST Admin API).
type Raw = Record<string, unknown>;
const str = (v: unknown): string | null => (v == null ? null : String(v));

export function normalizeEmail(email: unknown): string | null {
  const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
  return e || null;
}

export interface MappedCustomer {
  externalId: string | null;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  /** Shopify marketing consent: true=subscribed, false=not, null=unknown. */
  acceptsMarketing: boolean | null;
}

export function mapCustomer(raw: Raw | null | undefined): MappedCustomer | null {
  if (!raw) return null;
  const addr = raw.default_address as Raw | undefined;
  return {
    externalId: str(raw.id),
    email: normalizeEmail(raw.email),
    phone: normalizeE164((raw.phone as string) ?? (addr?.phone as string) ?? null),
    firstName: str(raw.first_name),
    lastName: str(raw.last_name),
    acceptsMarketing: mapAcceptsMarketing(raw),
  };
}

/** Read marketing consent from the new consent object or the legacy boolean. */
export function mapAcceptsMarketing(raw: Raw): boolean | null {
  const consent = raw.email_marketing_consent as Raw | undefined;
  if (consent && typeof consent.state === 'string') return consent.state === 'subscribed';
  if (typeof raw.accepts_marketing === 'boolean') return raw.accepts_marketing;
  return null;
}

export interface MappedProduct {
  externalId: string;
  title: string;
  imageUrl: string | null;
}

export function mapProduct(raw: Raw): MappedProduct {
  const image = raw.image as Raw | undefined;
  const images = raw.images as Raw[] | undefined;
  return {
    externalId: String(raw.id),
    title: (raw.title as string) ?? '',
    imageUrl: (image?.src as string) ?? (images?.[0]?.src as string) ?? null,
  };
}

export interface MappedLineItem {
  productExternalId: string | null;
  title: string;
  variant: string | null;
  quantity: number;
  priceMinor: number;
}

export function mapLineItem(raw: Raw): MappedLineItem {
  return {
    productExternalId: str(raw.product_id),
    title: (raw.title as string) ?? '',
    variant: (raw.variant_title as string) ?? null, // apparel SIZE/COLOUR
    quantity: Number(raw.quantity ?? 1),
    priceMinor: parseMinor(raw.price as string),
  };
}

export interface MappedOrder {
  externalId: string;
  orderNumber: string | null;
  /** Links back to the originating checkout/cart (Cart.externalId). */
  checkoutToken: string | null;
  customer: MappedCustomer | null;
  /** Guest orders may only carry an email on the order itself. */
  contactEmail: string | null;
  status: OrderStatus;
  financialStatus: FinancialStatus;
  totalMinor: number;
  currency: string;
  discountCode: string | null;
  discountMinor: number;
  refundedMinor: number;
  /** First-touch UTM/referrer ride-along from cart attributes (may be null). */
  attributes: OrderAttributes | null;
  placedAt: Date;
  items: MappedLineItem[];
}

export function mapOrder(raw: Raw): MappedOrder {
  const financialStatus = mapFinancialStatus(raw.financial_status as string);
  const discountCodes = raw.discount_codes as Raw[] | undefined;
  return {
    externalId: String(raw.id),
    orderNumber: str(raw.order_number) ?? str(raw.name),
    checkoutToken: str(raw.checkout_token) ?? str(raw.checkout_id),
    customer: mapCustomer(raw.customer as Raw),
    contactEmail: normalizeEmail((raw.email as string) ?? (raw.contact_email as string)),
    status: mapOrderStatus(raw),
    financialStatus,
    totalMinor: parseMinor(raw.total_price as string),
    currency: (raw.currency as string) ?? 'INR',
    discountCode: (discountCodes?.[0]?.code as string) ?? null,
    discountMinor: parseMinor(raw.total_discounts as string),
    refundedMinor: sumRefunds(raw.refunds as Raw[]),
    attributes: extractShopifyAttribution(raw),
    placedAt: parseTime(raw.created_at as string) ?? new Date(),
    items: ((raw.line_items as Raw[]) ?? []).map(mapLineItem),
  };
}

/** Combine financial + fulfillment + cancellation into our OrderStatus. */
export function mapOrderStatus(raw: Raw): OrderStatus {
  if (raw.cancelled_at) return 'CANCELLED';
  const fin = (raw.financial_status as string)?.toLowerCase();
  const ful = (raw.fulfillment_status as string)?.toLowerCase();
  if (fin === 'refunded') return 'REFUNDED';
  if (ful === 'fulfilled') return 'FULFILLED';
  if (fin === 'paid' || fin === 'partially_refunded') return 'PAID';
  return 'PENDING';
}

export function mapFinancialStatus(raw: string | null | undefined): FinancialStatus {
  switch ((raw ?? '').toLowerCase()) {
    case 'paid':
      return 'PAID';
    case 'partially_refunded':
      return 'PARTIALLY_REFUNDED';
    case 'refunded':
      return 'REFUNDED';
    default:
      return 'PENDING';
  }
}

/** Sum successful refund transactions into minor units. */
export function sumRefunds(refunds: Raw[] | null | undefined): number {
  if (!refunds?.length) return 0;
  let total = 0;
  for (const refund of refunds) {
    const txns = (refund.transactions as Raw[]) ?? [];
    for (const t of txns) {
      const kind = (t.kind as string)?.toLowerCase();
      const status = (t.status as string)?.toLowerCase();
      if (kind === 'refund' && (status === undefined || status === 'success')) {
        total += parseMinor(t.amount as string);
      }
    }
  }
  return total;
}

/**
 * Recompute financial status after a refund: fully refunded → REFUNDED, some
 * refunded → PARTIALLY_REFUNDED, else PAID. The order is never zeroed/deleted.
 */
export function recomputeFinancialStatus(totalMinor: number, refundedMinor: number): FinancialStatus {
  if (refundedMinor <= 0) return 'PAID';
  if (refundedMinor >= totalMinor) return 'REFUNDED';
  return 'PARTIALLY_REFUNDED';
}

export interface MappedCheckout {
  externalId: string;
  customer: MappedCustomer | null;
  contactEmail: string | null;
  attributes: OrderAttributes | null;
  checkoutStartedAt: Date;
  items: MappedLineItem[];
}

export function mapCheckout(raw: Raw): MappedCheckout {
  return {
    externalId: String(raw.token ?? raw.id),
    customer: mapCustomer(raw.customer as Raw),
    contactEmail: normalizeEmail(raw.email as string),
    attributes: extractShopifyAttribution(raw),
    checkoutStartedAt: parseTime(raw.created_at as string) ?? new Date(),
    items: ((raw.line_items as Raw[]) ?? []).map(mapLineItem),
  };
}

function parseTime(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}
