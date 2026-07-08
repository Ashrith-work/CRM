import { Injectable } from '@nestjs/common';
import { RFM_SEGMENTS, type AnalyticsSummary } from '@crm/types';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Analytics reads — over the denormalized CustomerFeatures (written from the
 * customer_rfm materialized view). Never recomputes RFM inline.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(organizationId: string): Promise<AnalyticsSummary> {
    const scoredWhere = { organizationId, rScore: { not: null } };
    const [totalCustomers, scoredCustomers, agg, refreshed, dist, sampleCurrency] = await Promise.all([
      this.prisma.customer.count({ where: { organizationId, deletedAt: null, mergedIntoId: null } }),
      this.prisma.customerFeatures.count({ where: scoredWhere }),
      this.prisma.customerFeatures.aggregate({ where: scoredWhere, _sum: { netRevenueMinor: true, orderCount: true } }),
      this.prisma.customerFeatures.aggregate({ where: scoredWhere, _max: { updatedAt: true } }),
      this.prisma.customerFeatures.groupBy({
        by: ['rSegment'],
        where: scoredWhere,
        _count: { _all: true },
        _sum: { netRevenueMinor: true },
      }),
      this.prisma.customerFeatures.findFirst({ where: { organizationId, currency: { not: null } }, select: { currency: true } }),
    ]);

    const net = agg._sum.netRevenueMinor ?? 0;
    const orders = agg._sum.orderCount ?? 0;
    const bySeg = new Map(dist.map((d) => [d.rSegment ?? '', { customers: d._count._all, net: d._sum.netRevenueMinor ?? 0 }]));

    // Order the distribution by the canonical segment list; drop empties.
    const distribution = RFM_SEGMENTS.filter((s) => bySeg.has(s)).map((segment) => ({
      segment,
      customers: bySeg.get(segment)!.customers,
      netRevenueMinor: bySeg.get(segment)!.net,
    }));

    return {
      scoredCustomers,
      totalCustomers,
      netRevenueMinor: net,
      aovMinor: orders ? Math.round(net / orders) : 0,
      currency: sampleCurrency?.currency ?? null,
      lastRefreshedAt: refreshed._max.updatedAt ? refreshed._max.updatedAt.toISOString() : null,
      distribution,
    };
  }
}
