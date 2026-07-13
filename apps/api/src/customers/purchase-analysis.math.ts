import type { PurchaseOrderRow } from '@crm/types';

/**
 * PURE purchase-profile math — assembles one order row (last / 2nd-last) from an
 * order + its line items + the products' metadata. No DB, no I/O → golden-
 * testable. Money is integer minor units; the discount % is a [0,1] fraction of
 * the pre-discount subtotal (null when the subtotal is 0). Mode is intentionally
 * BLANK (reserved for a future Shopify POS location → store mapping). Fabrics are
 * read from the Shopify product TAGS — never fabricated.
 */

/** Fabric vocabulary — a tag is treated as a "fabric" if it contains one of these
 *  (case-insensitive). Surfaced tags keep their original casing. Extend as needed. */
export const FABRIC_KEYWORDS = [
  'silk', 'cotton', 'linen', 'georgette', 'chiffon', 'crepe', 'organza', 'tissue',
  'satin', 'velvet', 'wool', 'chanderi', 'tussar', 'tuss-r', 'kanjivaram', 'kanchipuram',
  'banarasi', 'muslin', 'rayon', 'polyester', 'viscose', 'khadi', 'jute', 'denim',
  'maheshwari', 'matka', 'gadwal', 'ikat', 'patola', 'kota', 'mulmul', 'modal',
] as const;

export interface OrderForRow {
  id: string;
  orderNumber: string | null;
  placedAt: Date;
  totalMinor: number;
  refundedMinor: number;
  currency: string;
  discountCode: string | null;
  discountMinor: number;
}

export interface LineItemForRow {
  title: string;
  variant: string | null;
  quantity: number;
  priceMinor: number;
  productId: string | null;
}

export interface ProductMeta {
  productType: string | null;
  tags: string[];
}

/** Tags that name a fabric (deduped, original casing). Empty when none match. */
export function fabricsFrom(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const lower = tag.toLowerCase();
    if (FABRIC_KEYWORDS.some((k) => lower.includes(k)) && !seen.has(lower)) {
      seen.add(lower);
      out.push(tag);
    }
  }
  return out;
}

/** Pre-discount subtotal = Σ(unit price × quantity) over the line items. */
export function subtotalMinor(items: LineItemForRow[]): number {
  return items.reduce((s, it) => s + it.priceMinor * it.quantity, 0);
}

export function assembleOrderRow(
  order: OrderForRow,
  items: LineItemForRow[],
  productMeta: Map<string, ProductMeta>,
  segment: string | null,
): PurchaseOrderRow {
  const subtotal = subtotalMinor(items);
  const hasDiscount = order.discountMinor > 0 || !!order.discountCode;

  const fabricSet = new Set<string>();
  const typeSet = new Set<string>();
  for (const it of items) {
    const meta = it.productId ? productMeta.get(it.productId) : undefined;
    if (meta) {
      for (const f of fabricsFrom(meta.tags)) fabricSet.add(f);
      if (meta.productType) typeSet.add(meta.productType);
    }
  }

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    placedAt: order.placedAt.toISOString(),
    segment,
    mode: null, // reserved (Shopify POS location → store label); blank for now
    valueMinor: order.totalMinor - order.refundedMinor,
    currency: order.currency,
    discount: hasDiscount
      ? {
          code: order.discountCode,
          amountMinor: order.discountMinor,
          pct: subtotal > 0 ? order.discountMinor / subtotal : null,
        }
      : null,
    fabrics: [...fabricSet],
    productTypes: [...typeSet],
    products: items.map((it) => ({ title: it.title, variant: it.variant })),
  };
}
