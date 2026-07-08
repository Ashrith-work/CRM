import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { daysSince, rfmCode, rfmSegment } from './rfm.util';

interface RfmRow {
  customer_id: string;
  r_score: number;
  f_score: number;
  m_score: number;
  frequency: number;
  monetary_minor: bigint | number;
  last_order_at: Date;
}

/**
 * Nightly RFM refresh: REFRESH the customer_rfm materialized view, then write
 * the derived scores + deterministic segment label into CustomerFeatures (the
 * denormalized read model the profile badges + segment engine read). netRevenue/
 * orderCount are set from the view (paid/fulfilled, refund-adjusted) so features
 * are canonical.
 */
@Injectable()
export class RfmRefreshService {
  private readonly logger = new Logger(RfmRefreshService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** REFRESH MATERIALIZED VIEW CONCURRENTLY (fallback to plain on failure). */
  async refreshView(): Promise<void> {
    await this.refreshOne('customer_rfm');
  }

  /** Refresh the P2.1 analytics views (revenue/cohort/clv/margin). */
  async refreshAnalyticsViews(): Promise<void> {
    for (const view of ['revenue_daily', 'cohort_retention', 'customer_clv', 'contribution_margin']) {
      await this.refreshOne(view);
    }
  }

  private async refreshOne(view: string): Promise<void> {
    try {
      await this.prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${view}`);
    } catch (err) {
      this.logger.warn(`CONCURRENTLY refresh of ${view} failed (${(err as Error).message}); falling back`);
      await this.prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW ${view}`);
    }
  }

  /** Write clvMinor + clvBand into CustomerFeatures from the customer_clv view. */
  async writeClvForOrg(organizationId: string): Promise<void> {
    const rows = await this.prisma.$queryRaw<Array<{ customer_id: string; clv_minor: bigint | number; clv_band: string }>>`
      SELECT customer_id, clv_minor, clv_band FROM customer_clv WHERE organization_id = ${organizationId}`;
    for (const row of rows) {
      await this.prisma.customerFeatures.upsert({
        where: { organizationId_customerId: { organizationId, customerId: row.customer_id } },
        update: { clvMinor: Number(row.clv_minor), clvBand: row.clv_band },
        create: { organizationId, customerId: row.customer_id, clvMinor: Number(row.clv_minor), clvBand: row.clv_band },
      });
    }
  }

  /** Refresh all views, then rewrite RFM + CLV features for every org. */
  async refreshAll(now = new Date()): Promise<{ orgs: number; customers: number }> {
    await this.refreshView();
    await this.refreshAnalyticsViews();
    const orgs = await this.prisma.$queryRaw<Array<{ organization_id: string }>>`
      SELECT DISTINCT organization_id FROM customer_rfm`;
    let customers = 0;
    for (const { organization_id } of orgs) {
      customers += await this.writeFeaturesForOrg(organization_id, now);
      await this.writeClvForOrg(organization_id);
    }
    this.logger.log(`Analytics refresh: RFM + CLV for ${customers} customer(s) across ${orgs.length} org(s)`);
    return { orgs: orgs.length, customers };
  }

  /** Write CustomerFeatures for one org from the view; null RFM for the rest. */
  async writeFeaturesForOrg(organizationId: string, now = new Date()): Promise<number> {
    const rows = await this.prisma.$queryRaw<RfmRow[]>`
      SELECT customer_id, r_score, f_score, m_score, frequency, monetary_minor, last_order_at
      FROM customer_rfm WHERE organization_id = ${organizationId}`;

    for (const row of rows) {
      const r = row.r_score;
      const f = row.f_score;
      const m = row.m_score;
      const monetary = Number(row.monetary_minor);
      const frequency = row.frequency;
      const data = {
        rScore: r,
        fScore: f,
        mScore: m,
        rSegment: rfmSegment(r, f, m),
        rfmScore: rfmCode(r, f, m),
        daysSinceLast: daysSince(row.last_order_at, now),
        netRevenueMinor: monetary,
        orderCount: frequency,
        avgOrderValueMinor: frequency ? Math.round(monetary / frequency) : 0,
        lastOrderAt: row.last_order_at,
      };
      await this.prisma.customerFeatures.upsert({
        where: { organizationId_customerId: { organizationId, customerId: row.customer_id } },
        update: data,
        create: { organizationId, customerId: row.customer_id, ...data },
      });
    }

    // Customers with no paid/fulfilled orders drop out of RFM — clear their scores.
    const scoredIds = rows.map((r) => r.customer_id);
    await this.prisma.customerFeatures.updateMany({
      where: { organizationId, customerId: { notIn: scoredIds.length ? scoredIds : ['__none__'] } },
      data: { rScore: null, fScore: null, mScore: null, rSegment: null, rfmScore: null } as Prisma.CustomerFeaturesUpdateManyMutationInput,
    });
    return rows.length;
  }
}
