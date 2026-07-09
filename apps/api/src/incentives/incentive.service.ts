import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  Incentive as IncentiveDto,
  IncentiveConfigResponse,
  TriggerMetric,
  TriggerRule,
} from '@crm/types';
import { Prisma, type Incentive as IncentiveRow } from '@prisma/client';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { MarketingConsentGate } from '../campaigns/marketing-consent-gate.service';
import { ResendAdapter } from '../messaging/resend.adapter';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { ShopifyDiscountService } from './shopify-discount.service';

export interface IncentiveOrder {
  externalId: string;
  customerId: string | null;
  status: string;
  discountCode: string | null;
}

interface MarginExclusions {
  excluded: string[];
  /** Config requested the guard. */
  requested: boolean;
  /** The guard had cost data to act on (else we DON'T pretend it protected). */
  effective: boolean;
}

/**
 * Threshold incentive engine. State the numbers before storing: a VALUE cap
 * (not just %), low-margin-SKU exclusion, a minimum next-order value, and a
 * validity window. Redemption is tracked once (redeemedOrderId); a refund of the
 * qualifying order reverses it; notifications go through M4's ConsentGate.
 */
@Injectable()
export class IncentiveService {
  private readonly logger = new Logger(IncentiveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly discounts: ShopifyDiscountService,
    private readonly gate: MarketingConsentGate,
    private readonly email: ResendAdapter,
    private readonly loyalty: LoyaltyService,
  ) {}

  // ----- config -----------------------------------------------------------
  triggerRule(): TriggerRule {
    return {
      metric: this.config.get('INCENTIVE_TRIGGER_METRIC', { infer: true }) as TriggerMetric,
      threshold: this.config.get('INCENTIVE_TRIGGER_THRESHOLD', { infer: true }),
    };
  }

  configResponse(): IncentiveConfigResponse {
    return {
      marginGuard: this.config.get('INCENTIVE_MARGIN_GUARD', { infer: true }),
      marginFloorPct: this.config.get('INCENTIVE_MARGIN_FLOOR_PCT', { infer: true }),
      trigger: this.triggerRule(),
      maxValueMinor: this.config.get('INCENTIVE_MAX_VALUE_MINOR', { infer: true }),
      minNextOrderMinor: this.config.get('INCENTIVE_MIN_NEXT_ORDER_MINOR', { infer: true }),
    };
  }

  // ----- the precise "X products" metric ----------------------------------
  /** Measure the trigger metric over the customer's paid/fulfilled orders. */
  async measure(organizationId: string, customerId: string, rule: TriggerRule): Promise<number> {
    const since = rule.windowDays ? new Date(Date.now() - rule.windowDays * 86_400_000) : undefined;
    const orderWhere: Prisma.OrderWhereInput = {
      organizationId,
      customerId,
      deletedAt: null,
      status: { in: ['PAID', 'FULFILLED'] as ('PAID' | 'FULFILLED')[] },
      ...(since ? { placedAt: { gte: since } } : {}),
    };

    if (rule.metric === 'orders') {
      return this.prisma.order.count({ where: orderWhere });
    }
    if (rule.metric === 'units') {
      const agg = await this.prisma.orderItem.aggregate({ where: { organizationId, order: orderWhere }, _sum: { quantity: true } });
      return agg._sum?.quantity ?? 0;
    }
    // distinct_skus
    const rows = await this.prisma.orderItem.findMany({ where: { organizationId, order: orderWhere, productId: { not: null } }, select: { productId: true }, distinct: ['productId'] });
    return rows.length;
  }

  // ----- order lifecycle hooks (called from M1 ingestion) -----------------
  /** Redemption detection + qualification, in that order. */
  async onOrder(organizationId: string, order: IncentiveOrder): Promise<void> {
    if (!order.customerId) return;
    await this.detectRedemption(organizationId, order);
    await this.evaluateForOrder(organizationId, order);
  }

  /** Mark an incentive REDEEMED when a matching code lands (once only). */
  private async detectRedemption(organizationId: string, order: IncentiveOrder): Promise<void> {
    if (!order.discountCode) return;
    const incentive = await this.prisma.incentive.findFirst({
      where: { organizationId, status: 'ACTIVE', discountCode: { equals: order.discountCode, mode: 'insensitive' } },
    });
    if (!incentive) return; // unknown code, or already redeemed/expired → no double-redemption
    await this.prisma.incentive.update({
      where: { id: incentive.id },
      data: { status: 'REDEEMED', redeemedOrderId: order.externalId },
    });
    if (incentive.pointsCost > 0 && order.customerId) {
      // Burn the points this incentive cost (loyalty burn on redemption).
      await this.loyalty.burn(organizationId, order.customerId, incentive.pointsCost, order.externalId, `Redeemed incentive ${incentive.discountCode}`).catch((e) => this.logger.warn(`points burn failed: ${(e as Error).message}`));
    }
    this.logger.log(`Incentive ${incentive.discountCode} redeemed by order ${order.externalId}`);
  }

  /** Issue an incentive when the customer crosses the threshold (one active at a time). */
  async evaluateForOrder(organizationId: string, order: IncentiveOrder): Promise<IncentiveDto | null> {
    if (!order.customerId || (order.status !== 'PAID' && order.status !== 'FULFILLED')) return null;
    const existing = await this.prisma.incentive.findFirst({ where: { organizationId, customerId: order.customerId, status: 'ACTIVE' } });
    if (existing) return null; // don't stack a second active incentive

    const rule = this.triggerRule();
    const measured = await this.measure(organizationId, order.customerId, rule);
    if (measured < rule.threshold) return null;

    return this.issue(organizationId, order.customerId, order.externalId, rule);
  }

  /** Issue the incentive: capped value, excluded SKUs, min-order, validity, code. */
  async issue(organizationId: string, customerId: string, sourceOrderId: string | null, rule: TriggerRule): Promise<IncentiveDto> {
    const maxValueMinor = this.config.get('INCENTIVE_MAX_VALUE_MINOR', { infer: true });
    const minNextOrderMinor = this.config.get('INCENTIVE_MIN_NEXT_ORDER_MINOR', { infer: true });
    const validityDays = this.config.get('INCENTIVE_VALIDITY_DAYS', { infer: true });
    // Fixed-amount reward = the cap, so the discount VALUE can never exceed it.
    const valueMinor = maxValueMinor;

    const margin = await this.marginExclusions(organizationId);
    if (margin.requested && !margin.effective) {
      this.logger.warn(`Incentive for ${customerId}: margin guard requested but NO cost data — issuing WITHOUT margin protection (exposed).`);
    }

    const validFrom = new Date();
    const validUntil = new Date(validFrom.getTime() + validityDays * 86_400_000);
    const { code, external } = await this.discounts.issue({
      valueMinor,
      minSubtotalMinor: minNextOrderMinor,
      excludedProductExternalIds: margin.excluded,
      validFrom,
      validUntil,
      title: `Loyalty reward for customer ${customerId}`,
    });

    const row = await this.prisma.incentive.create({
      data: {
        organizationId,
        customerId,
        triggerRule: rule as unknown as Prisma.InputJsonValue,
        discountType: 'FIXED_AMOUNT',
        discountValueMinor: valueMinor,
        maxValueMinor,
        minNextOrderMinor,
        excludedSkuRule: { productExternalIds: margin.excluded } as Prisma.InputJsonValue,
        marginGuard: margin.requested && margin.effective, // honest: only true when it actually ran
        discountCode: code,
        validFrom,
        validUntil,
        status: 'ACTIVE',
        sourceOrderId,
      },
    });
    if (!external) this.logger.log(`Incentive ${code} stored locally (Shopify offline/mock).`);

    await this.notify(organizationId, customerId, row);
    return serializeIncentive(row);
  }

  /** A refund of the QUALIFYING order voids its still-active incentive. */
  async onRefund(organizationId: string, orderExternalId: string): Promise<void> {
    const { count } = await this.prisma.incentive.updateMany({
      where: { organizationId, sourceOrderId: orderExternalId, status: 'ACTIVE' },
      data: { status: 'EXPIRED' },
    });
    if (count) this.logger.log(`Refund of ${orderExternalId} reversed ${count} incentive(s)`);
  }

  /** Sweep: expire ACTIVE incentives past their window. */
  async expireDue(now = new Date()): Promise<number> {
    const { count } = await this.prisma.incentive.updateMany({
      where: { status: 'ACTIVE', validUntil: { lt: now } },
      data: { status: 'EXPIRED' },
    });
    if (count) this.logger.log(`Expired ${count} incentive(s)`);
    return count;
  }

  // ----- margin guard (real — uses M5 cost data) --------------------------
  /** Product externalIds that are provably low-margin (excluded from the code). */
  async marginExclusions(organizationId: string): Promise<MarginExclusions> {
    const requested = this.config.get('INCENTIVE_MARGIN_GUARD', { infer: true });
    if (!requested) return { excluded: [], requested: false, effective: false };

    const products = await this.prisma.product.findMany({ where: { organizationId, deletedAt: null, costMinor: { not: null } }, select: { id: true, externalId: true, costMinor: true } });
    if (products.length === 0) return { excluded: [], requested: true, effective: false }; // no data → don't pretend

    const floorPct = this.config.get('INCENTIVE_MARGIN_FLOOR_PCT', { infer: true });
    const avg = await this.prisma.orderItem.groupBy({ by: ['productId'], where: { organizationId, productId: { in: products.map((p) => p.id) } }, _avg: { priceMinor: true } });
    const avgById = new Map(avg.map((a) => [a.productId as string, a._avg.priceMinor ?? 0]));

    const excluded: string[] = [];
    for (const p of products) {
      const avgPrice = avgById.get(p.id) ?? 0;
      if (avgPrice <= 0) continue; // never sold → can't judge margin, leave in
      const marginPct = ((avgPrice - (p.costMinor ?? 0)) / avgPrice) * 100;
      if (marginPct < floorPct) excluded.push(p.externalId);
    }
    return { excluded, requested: true, effective: true };
  }

  // ----- notify (consent-gated) -------------------------------------------
  /** Notify the customer of their reward — ONLY with marketing consent. */
  async notify(organizationId: string, customerId: string, incentive: IncentiveRow): Promise<void> {
    const customer = await this.prisma.customer.findFirst({ where: { organizationId, id: customerId }, select: { email: true } });
    if (!customer?.email) return; // no address → the code just attaches silently in Shopify
    const decision = await this.gate.canSend(organizationId, customerId, customer.email);
    if (!decision.allowed) {
      this.logger.log(`Reward notification suppressed for ${customer.email}: ${decision.reason} (code still attaches in Shopify)`);
      return;
    }
    const body = `Use code ${incentive.discountCode} for ₹${(incentive.discountValueMinor ?? 0) / 100} off your next order over ₹${incentive.minNextOrderMinor / 100}. Valid until ${incentive.validUntil.toISOString().slice(0, 10)}.`;
    await this.email
      .send({ to: customer.email, subject: 'You’ve earned a reward 🎁', text: body, html: `<p>${body}</p>` })
      .catch((e) => this.logger.warn(`Reward email failed: ${(e as Error).message}`));
  }

  // ----- reads ------------------------------------------------------------
  async list(organizationId: string, customerId?: string): Promise<IncentiveDto[]> {
    const rows = await this.prisma.incentive.findMany({
      where: { organizationId, ...(customerId ? { customerId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map(serializeIncentive);
  }
}

export function serializeIncentive(row: IncentiveRow): IncentiveDto {
  return {
    id: row.id,
    customerId: row.customerId,
    triggerRule: row.triggerRule as unknown as TriggerRule,
    discountType: row.discountType,
    discountValueMinor: row.discountValueMinor,
    discountPercent: row.discountPercent,
    maxValueMinor: row.maxValueMinor,
    minNextOrderMinor: row.minNextOrderMinor,
    excludedSkuRule: (row.excludedSkuRule as { productExternalIds: string[] } | null) ?? null,
    pointsCost: row.pointsCost,
    marginGuard: row.marginGuard,
    discountCode: row.discountCode,
    validFrom: row.validFrom.toISOString(),
    validUntil: row.validUntil.toISOString(),
    status: row.status,
    sourceOrderId: row.sourceOrderId,
    redeemedOrderId: row.redeemedOrderId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
