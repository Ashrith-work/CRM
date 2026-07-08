import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type ChurnBand = 'Low' | 'Medium' | 'High' | 'Unknown';

export interface ChurnResult {
  band: ChurnBand;
  score: number | null; // 0..1
  reason: string;
}

/**
 * Heuristic (explainable, NON-ML) churn score. The rule is deterministic and
 * defensible: compare a customer's days-since-last-order to their own median
 * inter-purchase interval.
 *   • < 2 orders            → Unknown  (insufficient history — don't over-flag)
 *   • daysSinceLast ≤ 1×gap → Low      (ordering on their normal cadence)
 *   • ≤ 2×gap               → Medium
 *   • > 2×gap               → High
 * score = min(1, ratio / 3). Runs weekly (tiered refresh).
 */
export function scoreChurn(orderDatesAsc: Date[], now: Date): ChurnResult {
  const n = orderDatesAsc.length;
  if (n < 2) return { band: 'Unknown', score: null, reason: `only ${n} order(s) — insufficient history` };

  const gaps: number[] = [];
  for (let i = 1; i < n; i++) gaps.push((orderDatesAsc[i].getTime() - orderDatesAsc[i - 1].getTime()) / 86_400_000);
  const medianGap = Math.max(1, median(gaps)); // floor at 1 day to avoid divide-by-zero
  const daysSinceLast = (now.getTime() - orderDatesAsc[n - 1].getTime()) / 86_400_000;
  const ratio = daysSinceLast / medianGap;

  const band: ChurnBand = ratio <= 1 ? 'Low' : ratio <= 2 ? 'Medium' : 'High';
  const score = Math.min(1, ratio / 3);
  const reason = `${Math.round(daysSinceLast)}d since last vs ~${Math.round(medianGap)}d median gap (${ratio.toFixed(1)}×)`;
  return { band, score: Number(score.toFixed(4)), reason };
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

@Injectable()
export class ChurnScoreService {
  private readonly logger = new Logger(ChurnScoreService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Score every org's customers (weekly). */
  async scoreAll(now = new Date()): Promise<{ orgs: number; customers: number }> {
    const orgs = await this.prisma.$queryRaw<Array<{ organization_id: string }>>`
      SELECT DISTINCT organization_id FROM customer_clv`;
    let customers = 0;
    for (const { organization_id } of orgs) customers += await this.scoreOrg(organization_id, now);
    this.logger.log(`Churn scored ${customers} customer(s) across ${orgs.length} org(s)`);
    return { orgs: orgs.length, customers };
  }

  async scoreOrg(organizationId: string, now = new Date()): Promise<number> {
    // One pass: all paid/fulfilled orders for the org, oldest-first per customer.
    const orders = await this.prisma.order.findMany({
      where: { organizationId, deletedAt: null, customerId: { not: null }, status: { in: ['PAID', 'FULFILLED'] } },
      select: { customerId: true, placedAt: true },
      orderBy: { placedAt: 'asc' },
    });
    const byCustomer = new Map<string, Date[]>();
    for (const o of orders) {
      const list = byCustomer.get(o.customerId!) ?? [];
      list.push(o.placedAt);
      byCustomer.set(o.customerId!, list);
    }

    for (const [customerId, dates] of byCustomer) {
      const { band, score } = scoreChurn(dates, now);
      await this.prisma.customerFeatures.upsert({
        where: { organizationId_customerId: { organizationId, customerId } },
        update: { churnBand: band, churnRisk: score },
        create: { organizationId, customerId, churnBand: band, churnRisk: score },
      });
    }
    return byCustomer.size;
  }
}
