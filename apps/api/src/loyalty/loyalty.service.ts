import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LoyaltyBalanceResponse, LoyaltyLedgerResponse, LoyaltyTransaction } from '@crm/types';
import type { LoyaltyTransaction as LoyaltyRow } from '@prisma/client';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

/** Minimal order shape the ledger needs to reconcile earned points. */
export interface OrderForLoyalty {
  externalId: string;
  customerId: string | null;
  status: string;
  totalMinor: number;
  refundedMinor: number;
}

/**
 * APPEND-ONLY loyalty ledger. Balance is ALWAYS SUM(delta) — never a mutable
 * field. Earn on paid/fulfilled orders, burn on redemption, negative CLAWBACK on
 * refund. Rows are never edited or deleted; earn/clawback CONVERGE the order's
 * ledger to its target (floor(net ÷ divisor)), so re-processing is idempotent.
 */
@Injectable()
export class LoyaltyService {
  private readonly logger = new Logger(LoyaltyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private divisor(): number {
    return this.config.get('LOYALTY_EARN_DIVISOR_MINOR', { infer: true });
  }

  /**
   * Reconcile an order's earned points to its target and write the correcting
   * delta (EARN if it went up, CLAWBACK if a refund pulled it down). Idempotent:
   * a no-change reconcile writes nothing. Returns the delta written.
   */
  async reconcileOrder(organizationId: string, order: OrderForLoyalty): Promise<number> {
    if (!order.customerId) return 0;
    const target = computePoints(order.status, order.totalMinor, order.refundedMinor, this.divisor());
    const current = await this.orderLedger(organizationId, order.externalId);
    const delta = target - current;
    if (delta === 0) return 0;
    await this.prisma.loyaltyTransaction.create({
      data: {
        organizationId,
        customerId: order.customerId,
        delta,
        reason: delta > 0 ? 'EARN' : 'CLAWBACK',
        refOrderId: order.externalId,
        note: delta > 0 ? 'Points earned on order' : 'Clawback on refund',
      },
    });
    return delta;
  }

  /** Net earned/clawed points for one order (EARN + CLAWBACK only). */
  private async orderLedger(organizationId: string, refOrderId: string): Promise<number> {
    const agg = await this.prisma.loyaltyTransaction.aggregate({
      where: { organizationId, refOrderId, reason: { in: ['EARN', 'CLAWBACK'] } },
      _sum: { delta: true },
    });
    return agg._sum.delta ?? 0;
  }

  /** Burn (spend) points. Refuses to drive the balance negative. */
  async burn(organizationId: string, customerId: string, points: number, refOrderId: string | null, note: string): Promise<void> {
    if (points <= 0) throw new BadRequestException('points must be positive');
    const balance = await this.balanceValue(organizationId, customerId);
    if (points > balance) throw new BadRequestException(`insufficient points: balance ${balance}, requested ${points}`);
    await this.prisma.loyaltyTransaction.create({
      data: { organizationId, customerId, delta: -points, reason: 'BURN', refOrderId, note },
    });
  }

  async balanceValue(organizationId: string, customerId: string): Promise<number> {
    const agg = await this.prisma.loyaltyTransaction.aggregate({ where: { organizationId, customerId }, _sum: { delta: true } });
    return agg._sum.delta ?? 0;
  }

  async balance(organizationId: string, customerId: string): Promise<LoyaltyBalanceResponse> {
    const rows = await this.prisma.loyaltyTransaction.findMany({ where: { organizationId, customerId }, select: { delta: true } });
    let balance = 0;
    let earned = 0;
    let burned = 0;
    for (const r of rows) {
      balance += r.delta;
      if (r.delta > 0) earned += r.delta;
      else burned += -r.delta;
    }
    return { customerId, balance, earned, burned };
  }

  async ledger(organizationId: string, customerId: string, limit = 100): Promise<LoyaltyLedgerResponse> {
    const rows = await this.prisma.loyaltyTransaction.findMany({
      where: { organizationId, customerId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 500),
    });
    return { balance: await this.balanceValue(organizationId, customerId), data: rows.map(serializeLoyalty) };
  }

  /** Redeem (burn) points; returns the new balance. */
  async redeem(organizationId: string, customerId: string, points: number, note?: string): Promise<LoyaltyBalanceResponse> {
    await this.burn(organizationId, customerId, points, null, note ?? 'Manual redemption');
    return this.balance(organizationId, customerId);
  }
}

/** Pure earn math — floor(net ÷ divisor) on paid/fulfilled; 0 otherwise. */
export function computePoints(status: string, totalMinor: number, refundedMinor: number, divisor: number): number {
  if (status !== 'PAID' && status !== 'FULFILLED') return 0;
  const net = Math.max(0, totalMinor - refundedMinor);
  return Math.floor(net / divisor);
}

export function serializeLoyalty(row: LoyaltyRow): LoyaltyTransaction {
  return {
    id: row.id,
    customerId: row.customerId,
    delta: row.delta,
    reason: row.reason,
    refOrderId: row.refOrderId,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}
