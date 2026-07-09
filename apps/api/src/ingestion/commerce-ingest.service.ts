import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IdentityService } from '../customers/identity.service';
import { MarketingConsentWriter } from './marketing-consent.writer';
import { firstTouchSource } from '../attribution/utm.util';
import { ShopifyService, type ShopifyConn } from './shopify.service';
import {
  mapCheckout,
  mapCustomer,
  mapOrder,
  mapProduct,
  recomputeFinancialStatus,
  sumRefunds,
  type MappedCheckout,
  type MappedCustomer,
  type MappedOrder,
  type MappedProduct,
} from './shopify.mappers';

export type ProgressFn = (phase: string, processed: number, total: number | null) => Promise<void> | void;

/**
 * The single write path shared by BOTH the backfill worker and the webhook
 * processor, so historical and live data upsert identically. Every write is
 * idempotent on UNIQUE(org, externalId). Money is stored as integer minor units.
 */
@Injectable()
export class CommerceIngestService {
  private readonly logger = new Logger(CommerceIngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly shopify: ShopifyService,
    private readonly marketingConsent: MarketingConsentWriter,
  ) {}

  // ----- Per-entity upserts (idempotent) ----------------------------------
  async upsertProduct(organizationId: string, p: MappedProduct): Promise<string> {
    const row = await this.prisma.product.upsert({
      where: { organizationId_externalId: { organizationId, externalId: p.externalId } },
      update: { title: p.title, imageUrl: p.imageUrl, deletedAt: null },
      create: { organizationId, externalId: p.externalId, title: p.title, imageUrl: p.imageUrl },
    });
    return row.id;
  }

  async upsertCustomer(organizationId: string, c: MappedCustomer | null): Promise<string | null> {
    if (!c || (!c.externalId && !c.email && !c.phone)) return null;
    return this.identity.resolveCustomer(organizationId, c);
  }

  async upsertOrder(organizationId: string, o: MappedOrder): Promise<string> {
    const customerId = await this.upsertCustomer(
      organizationId,
      o.customer ?? (o.contactEmail ? { externalId: null, email: o.contactEmail, phone: null, firstName: null, lastName: null, acceptsMarketing: null } : null),
    );

    const existed = await this.prisma.order.findUnique({
      where: { organizationId_externalId: { organizationId, externalId: o.externalId } },
      select: { id: true },
    });

    // First-touch source from the cart attributes (Part 9). "unknown" when the
    // UTMs were absent — never fabricated.
    const source = firstTouchSource(o.attributes);

    const order = await this.prisma.order.upsert({
      where: { organizationId_externalId: { organizationId, externalId: o.externalId } },
      update: {
        orderNumber: o.orderNumber,
        customerId,
        status: o.status,
        financialStatus: o.financialStatus,
        totalMinor: o.totalMinor,
        refundedMinor: o.refundedMinor,
        currency: o.currency,
        discountCode: o.discountCode,
        discountMinor: o.discountMinor,
        placedAt: o.placedAt,
        // Only overwrite attributes when this payload carried them (don't wipe).
        ...(o.attributes ? { attributes: o.attributes as Prisma.InputJsonValue, firstTouchSource: source } : {}),
        deletedAt: null,
      },
      create: {
        organizationId,
        externalId: o.externalId,
        orderNumber: o.orderNumber,
        customerId,
        status: o.status,
        financialStatus: o.financialStatus,
        totalMinor: o.totalMinor,
        refundedMinor: o.refundedMinor,
        currency: o.currency,
        discountCode: o.discountCode,
        discountMinor: o.discountMinor,
        ...(o.attributes ? { attributes: o.attributes as Prisma.InputJsonValue } : {}),
        firstTouchSource: source,
        placedAt: o.placedAt,
      },
    });

    // Store the order-level touchpoint (Part 9 — EVERY touchpoint). Idempotent on
    // (org, channel, sessionId=order externalId).
    await this.prisma.touchpoint.upsert({
      where: { organizationId_channel_sessionId: { organizationId, channel: 'web', sessionId: o.externalId } },
      update: { customerId, source, occurredAt: o.placedAt },
      create: {
        organizationId,
        customerId,
        channel: 'web',
        sessionId: o.externalId,
        source,
        campaign: (o.attributes?.utm?.campaign as string | undefined) ?? null,
        utm: (o.attributes ?? undefined) as never,
        occurredAt: o.placedAt,
      },
    });

    // Replace items (upsert-by-parent).
    await this.prisma.orderItem.deleteMany({ where: { organizationId, orderId: order.id } });
    if (o.items.length) {
      await this.prisma.orderItem.createMany({
        data: await Promise.all(
          o.items.map(async (it) => ({
            organizationId,
            orderId: order.id,
            productId: await this.resolveProductId(organizationId, it.productExternalId),
            title: it.title,
            variant: it.variant,
            quantity: it.quantity,
            priceMinor: it.priceMinor,
          })),
        ),
      });
    }

    // Link a matching checkout/cart → halts M4 abandoned-cart recovery.
    if (o.checkoutToken) {
      await this.prisma.cart.updateMany({
        where: { organizationId, externalId: o.checkoutToken, convertedOrderId: null },
        data: { convertedOrderId: order.id },
      });
    }

    // Emit ORDER_PLACED only on first sight (retried/updated webhooks won't dupe).
    if (!existed) {
      await this.event(organizationId, customerId, 'ORDER_PLACED', o.externalId, o.placedAt, { totalMinor: o.totalMinor });
    }

    // Customer 360 maintenance: timeline pointer + denormalized features.
    if (customerId) {
      await this.recordOrderInteraction(organizationId, customerId, o);
      await this.recomputeFeatures(organizationId, customerId);
      // P2.3 — capture MARKETING consent from Shopify so audience sync's
      // ConsentGate has real consented customers (only when the flag was sent).
      if (o.customer?.acceptsMarketing != null) {
        await this.marketingConsent.recordFromShopify(organizationId, customerId, o.customer.acceptsMarketing);
      }
    }
    return order.id;
  }

  /** Upsert the ORDER Interaction (timeline pointer) — idempotent on (org, type, refId). */
  async recordOrderInteraction(organizationId: string, customerId: string, o: MappedOrder): Promise<void> {
    const summary = `Order #${o.orderNumber ?? o.externalId} · ${moneyLabel(o.totalMinor, o.currency)} · ${o.financialStatus.toLowerCase()}`;
    await this.prisma.interaction.upsert({
      where: { organizationId_type_refId: { organizationId, type: 'ORDER', refId: o.externalId } },
      update: { customerId, summary, occurredAt: o.placedAt },
      create: { organizationId, customerId, type: 'ORDER', refId: o.externalId, summary, occurredAt: o.placedAt },
    });
  }

  /** Recompute the denormalized per-customer aggregates. Only paid/fulfilled
   * orders count (matches the RFM view + glossary); refunds subtract. */
  async recomputeFeatures(organizationId: string, customerId: string): Promise<void> {
    const agg = await this.prisma.order.aggregate({
      where: { organizationId, customerId, deletedAt: null, status: { in: ['PAID', 'FULFILLED'] } },
      _count: { _all: true },
      _sum: { totalMinor: true, refundedMinor: true },
      _min: { placedAt: true },
      _max: { placedAt: true },
    });
    const orderCount = agg._count._all;
    const netRevenueMinor = (agg._sum.totalMinor ?? 0) - (agg._sum.refundedMinor ?? 0);
    const latest = await this.prisma.order.findFirst({
      where: { organizationId, customerId, deletedAt: null, status: { in: ['PAID', 'FULFILLED'] } },
      orderBy: { placedAt: 'desc' },
      select: { currency: true },
    });
    const data = {
      netRevenueMinor,
      orderCount,
      firstOrderAt: agg._min.placedAt,
      lastOrderAt: agg._max.placedAt,
      avgOrderValueMinor: orderCount ? Math.round(netRevenueMinor / orderCount) : 0,
      currency: latest?.currency ?? null,
    };
    await this.prisma.customerFeatures.upsert({
      where: { organizationId_customerId: { organizationId, customerId } },
      update: data,
      create: { organizationId, customerId, ...data },
    });
  }

  async upsertCart(organizationId: string, c: MappedCheckout): Promise<string> {
    const customerId = await this.upsertCustomer(
      organizationId,
      c.customer ?? (c.contactEmail ? { externalId: null, email: c.contactEmail, phone: null, firstName: null, lastName: null, acceptsMarketing: null } : null),
    );
    const existed = await this.prisma.cart.findUnique({
      where: { organizationId_externalId: { organizationId, externalId: c.externalId } },
      select: { id: true },
    });

    const cart = await this.prisma.cart.upsert({
      where: { organizationId_externalId: { organizationId, externalId: c.externalId } },
      update: { customerId, checkoutStartedAt: c.checkoutStartedAt, ...(c.attributes ? { attributes: c.attributes as Prisma.InputJsonValue } : {}), deletedAt: null },
      create: { organizationId, externalId: c.externalId, customerId, checkoutStartedAt: c.checkoutStartedAt, ...(c.attributes ? { attributes: c.attributes as Prisma.InputJsonValue } : {}) },
    });

    await this.prisma.cartItem.deleteMany({ where: { organizationId, cartId: cart.id } });
    if (c.items.length) {
      await this.prisma.cartItem.createMany({
        data: await Promise.all(
          c.items.map(async (it) => ({
            organizationId,
            cartId: cart.id,
            productId: await this.resolveProductId(organizationId, it.productExternalId),
            title: it.title,
            variant: it.variant,
            quantity: it.quantity,
            priceMinor: it.priceMinor,
          })),
        ),
      });
    }

    if (!existed) {
      await this.event(organizationId, customerId, 'CHECKOUT_STARTED', c.externalId, c.checkoutStartedAt, {});
      for (const it of c.items) {
        await this.event(organizationId, customerId, 'ADD_TO_CART', c.externalId, c.checkoutStartedAt, { title: it.title, variant: it.variant });
      }
    }
    return cart.id;
  }

  /** refunds/create → add this refund, recompute financialStatus. Order kept, never zeroed. */
  async applyRefund(organizationId: string, orderExternalId: string, refundPayload: Record<string, unknown>): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { organizationId_externalId: { organizationId, externalId: orderExternalId } },
    });
    if (!order) {
      this.logger.warn(`refunds/create for unknown order ${orderExternalId} — skipped`);
      return;
    }
    const refundedMinor = order.refundedMinor + sumRefunds([refundPayload]);
    await this.prisma.order.update({
      where: { id: order.id },
      data: { refundedMinor, financialStatus: recomputeFinancialStatus(order.totalMinor, refundedMinor) },
    });
  }

  /** Dispatch a webhook payload by topic (same mappers as backfill). */
  async processTopic(organizationId: string, topic: string, payload: Record<string, unknown>): Promise<void> {
    switch (topic) {
      case 'orders/create':
      case 'orders/updated':
      case 'orders/paid':
      case 'orders/cancelled':
        await this.upsertOrder(organizationId, mapOrder(payload));
        break;
      case 'refunds/create':
        await this.applyRefund(organizationId, String(payload.order_id), payload);
        break;
      case 'customers/create':
      case 'customers/update':
        await this.upsertCustomer(organizationId, mapCustomer(payload));
        break;
      case 'checkouts/create':
      case 'checkouts/update':
        await this.upsertCart(organizationId, mapCheckout(payload));
        break;
      default:
        this.logger.debug(`Ignoring unhandled topic ${topic}`);
    }
  }

  // ----- Backfill + reconcile (call Shopify) ------------------------------
  /** Full historical import: customers → products → orders. */
  async backfill(organizationId: string, conn: ShopifyConn, onProgress: ProgressFn): Promise<{ customers: number; products: number; orders: number }> {
    let processed = 0;
    const customers = await this.shopify.paginate(conn, 'customers', {}, async (items) => {
      for (const it of items) await this.upsertCustomer(organizationId, mapCustomer(it));
      processed += items.length;
      await onProgress('customers', processed, null);
    });
    processed = 0;
    const products = await this.shopify.paginate(conn, 'products', {}, async (items) => {
      for (const it of items) await this.upsertProduct(organizationId, mapProduct(it));
      processed += items.length;
      await onProgress('products', processed, null);
    });
    processed = 0;
    const orders = await this.shopify.paginate(conn, 'orders', { status: 'any' }, async (items) => {
      for (const it of items) await this.upsertOrder(organizationId, mapOrder(it));
      processed += items.length;
      await onProgress('orders', processed, null);
    });
    return { customers, products, orders };
  }

  /** Re-import orders updated since `sinceISO` and compare counts (self-heal). */
  async reconcile(organizationId: string, conn: ShopifyConn, sinceISO: string): Promise<{ shopifyCount: number; fetched: number; crmCount: number }> {
    const shopifyCount = await this.shopify.orderCount(conn, { updatedAtMin: sinceISO });
    let fetched = 0;
    await this.shopify.paginate(conn, 'orders', { status: 'any', updated_at_min: sinceISO }, async (items) => {
      for (const it of items) await this.upsertOrder(organizationId, mapOrder(it));
      fetched += items.length;
    });
    const crmCount = await this.prisma.order.count({ where: { organizationId, deletedAt: null, updatedAt: { gte: new Date(sinceISO) } } });
    return { shopifyCount, fetched, crmCount };
  }

  // ----- helpers ----------------------------------------------------------
  private async resolveProductId(organizationId: string, externalId: string | null): Promise<string | null> {
    if (!externalId) return null;
    const p = await this.prisma.product.findUnique({
      where: { organizationId_externalId: { organizationId, externalId } },
      select: { id: true },
    });
    return p?.id ?? null;
  }

  private async event(
    organizationId: string,
    customerId: string | null,
    type: 'CHECKOUT_STARTED' | 'ADD_TO_CART' | 'ORDER_PLACED',
    externalId: string,
    occurredAt: Date,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.commerceEvent.create({
      data: { organizationId, customerId, type, externalId, occurredAt, metadata: metadata as Prisma.InputJsonValue },
    });

    // A checkout also lands on the 360 timeline as an EVENT interaction.
    if (customerId && type === 'CHECKOUT_STARTED') {
      await this.prisma.interaction.upsert({
        where: { organizationId_type_refId: { organizationId, type: 'EVENT', refId: externalId } },
        update: { customerId, summary: 'Checkout started', occurredAt },
        create: { organizationId, customerId, type: 'EVENT', refId: externalId, summary: 'Checkout started', occurredAt },
      });
    }
  }
}

/** Short money label for interaction summaries (₹ for INR, else "CUR 12.34"). */
function moneyLabel(minor: number, currency: string): string {
  const major = (minor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === 'INR' ? `₹${major}` : `${currency} ${major}`;
}
