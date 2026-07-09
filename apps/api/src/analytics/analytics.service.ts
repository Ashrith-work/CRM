import { Injectable } from '@nestjs/common';
import {
  RFM_SEGMENTS,
  type AnalyticsSummary,
  type ChurnWatchlistResponse,
  type ClvBand,
  type ClvDistributionResponse,
  type CohortResponse,
  type MarginResponse,
  type RevenueTrendResponse,
} from '@crm/types';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerPiiService } from '../customers/customer-pii.service';
import { maskEmail } from '../common/pii.util';

/**
 * Analytics reads — over the denormalized CustomerFeatures (written from the
 * customer_rfm materialized view). Never recomputes RFM inline.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pii: CustomerPiiService,
  ) {}

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

  // ----- P2.1 view-backed reads (never recompute inline) ------------------
  private async currencyFor(organizationId: string): Promise<string | null> {
    const row = await this.prisma.customerFeatures.findFirst({ where: { organizationId, currency: { not: null } }, select: { currency: true } });
    return row?.currency ?? null;
  }

  async revenueTrend(organizationId: string): Promise<RevenueTrendResponse> {
    const rows = await this.prisma.$queryRaw<Array<{ day: Date; net_revenue_minor: bigint; order_count: number }>>`
      SELECT day, net_revenue_minor, order_count FROM revenue_daily WHERE organization_id = ${organizationId} ORDER BY day ASC`;
    return {
      currency: await this.currencyFor(organizationId),
      data: rows.map((r) => ({ day: iso(r.day), netRevenueMinor: Number(r.net_revenue_minor), orderCount: r.order_count })),
    };
  }

  async cohorts(organizationId: string): Promise<CohortResponse> {
    const rows = await this.prisma.$queryRaw<Array<{ cohort_month: Date; period_number: number; cohort_size: number; active_customers: number; retention_pct: string }>>`
      SELECT cohort_month, period_number, cohort_size, active_customers, retention_pct
      FROM cohort_retention WHERE organization_id = ${organizationId} ORDER BY cohort_month ASC, period_number ASC`;
    const byCohort = new Map<string, CohortResponse['data'][number]>();
    let maxPeriod = 0;
    for (const r of rows) {
      const key = iso(r.cohort_month);
      const row = byCohort.get(key) ?? { cohortMonth: key, cohortSize: r.cohort_size, cells: [] };
      row.cells.push({ periodNumber: r.period_number, activeCustomers: r.active_customers, retentionPct: Number(r.retention_pct) });
      byCohort.set(key, row);
      if (r.period_number > maxPeriod) maxPeriod = r.period_number;
    }
    return { maxPeriod, data: [...byCohort.values()] };
  }

  async clvDistribution(organizationId: string): Promise<ClvDistributionResponse> {
    const rows = await this.prisma.$queryRaw<Array<{ clv_band: ClvBand; customers: number; total: bigint; mn: bigint; mx: bigint }>>`
      SELECT clv_band, COUNT(*)::int AS customers, SUM(clv_minor)::bigint AS total, MIN(clv_minor)::bigint AS mn, MAX(clv_minor)::bigint AS mx
      FROM customer_clv WHERE organization_id = ${organizationId} GROUP BY clv_band`;
    const order: ClvBand[] = ['High', 'Mid', 'Low'];
    const byBand = new Map(rows.map((r) => [r.clv_band, r]));
    return {
      currency: await this.currencyFor(organizationId),
      data: order.filter((b) => byBand.has(b)).map((band) => {
        const r = byBand.get(band)!;
        return { band, customers: r.customers, totalMinor: Number(r.total), minMinor: Number(r.mn), maxMinor: Number(r.mx) };
      }),
    };
  }

  async churnWatchlist(organizationId: string, unmasked: boolean, limit = 50): Promise<ChurnWatchlistResponse> {
    const feats = await this.prisma.customerFeatures.findMany({
      where: { organizationId, churnBand: { in: ['High', 'Medium'] } },
      orderBy: [{ clvMinor: 'desc' }],
      take: 500,
    });
    const clvRank = (b: string | null) => (b === 'High' ? 0 : b === 'Mid' ? 1 : 2);
    const churnRank = (b: string | null) => (b === 'High' ? 0 : 1);
    feats.sort((a, b) => churnRank(a.churnBand) - churnRank(b.churnBand) || clvRank(a.clvBand) - clvRank(b.clvBand) || (b.clvMinor ?? 0) - (a.clvMinor ?? 0));
    const top = feats.slice(0, limit);
    const customers = await this.prisma.customer.findMany({ where: { organizationId, id: { in: top.map((f) => f.customerId) } } });
    const byId = new Map(customers.map((c) => [c.id, c]));
    return {
      currency: await this.currencyFor(organizationId),
      data: top.map((f) => {
        const c = byId.get(f.customerId);
        // Decrypt server-side for this human-facing (RBAC-gated) watchlist.
        const revealed = c ? this.pii.reveal(c) : null;
        const name = c && revealed ? (this.pii.revealName(c) ?? '') || revealed.email || c.externalId || f.customerId : f.customerId;
        return {
          customerId: f.customerId,
          name,
          email: revealed ? (unmasked ? revealed.email : maskEmail(revealed.email)) : null,
          churnBand: (f.churnBand ?? 'Unknown') as ChurnWatchlistResponse['data'][number]['churnBand'],
          churnRisk: f.churnRisk,
          clvBand: f.clvBand,
          clvMinor: f.clvMinor ?? 0,
          daysSinceLast: f.daysSinceLast,
        };
      }),
    };
  }

  async margin(organizationId: string): Promise<MarginResponse> {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { hasCogs: true } });
    const rows = await this.prisma.$queryRaw<Array<{ day: Date; net_revenue_minor: bigint; cogs_minor: bigint; margin_minor: bigint; is_estimate: boolean }>>`
      SELECT day, net_revenue_minor, cogs_minor, margin_minor, is_estimate
      FROM contribution_margin WHERE organization_id = ${organizationId} ORDER BY day ASC`;
    const isEstimate = rows[0]?.is_estimate ?? !org?.hasCogs;
    return {
      isEstimate,
      label: isEstimate ? 'Estimated margin (excludes COGS)' : 'Contribution margin',
      currency: await this.currencyFor(organizationId),
      totalMarginMinor: rows.reduce((s, r) => s + Number(r.margin_minor), 0),
      data: rows.map((r) => ({ day: iso(r.day), netRevenueMinor: Number(r.net_revenue_minor), cogsMinor: Number(r.cogs_minor), marginMinor: Number(r.margin_minor) })),
    };
  }
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
