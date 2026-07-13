import { Injectable } from '@nestjs/common';
import type { KpiQueryInput, KpiResponse, KpiTopCategory, KpiTopProduct, KpiTrendPoint } from '@crm/types';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { safeTimeZone, localYmd } from '../common/timezone.util';
import { resolvePeriod, previousPeriod, generateBuckets, type Period } from '../dashboard/dashboard.period';
import {
  buildKpiMetrics,
  sumDaily,
  type KpiCustomerAgg,
  type KpiDailyRow,
} from './kpi.math';

/** A daily rollup row plus its local day (kept for trend bucketing). */
type DailyWithDay = KpiDailyRow & { _day: string };

const CACHE_TTL_SECONDS = 300; // 5 min — matches the dashboard read cache.

/** One raw commerce_kpi_daily row as returned by Postgres (bigints for money). */
interface RawDaily {
  day: Date;
  net_minor: bigint;
  gross_minor: bigint;
  refunded_minor: bigint;
  discount_minor: bigint;
  order_count: number;
  refund_order_count: number;
  discount_order_count: number;
  new_customer_count: number;
}

/**
 * Dashboard commerce KPIs — computed FROM the ingested Shopify data (the
 * `commerce_kpi_daily` materialized view + a few customer aggregates), never
 * re-fetched from Shopify. Period boundaries are bucketed in the ORG timezone
 * (matching the view). The whole payload is cached in Redis (short TTL).
 */
@Injectable()
export class KpiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async kpis(organizationId: string, query: KpiQueryInput, now = new Date()): Promise<KpiResponse> {
    const cacheKey = `kpis:${organizationId}:${JSON.stringify(query)}`;
    const cached = await this.redis.cacheGet<KpiResponse>(cacheKey);
    if (cached) return cached;

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { timezone: true },
    });
    const tz = safeTimeZone(org?.timezone);

    const period = resolvePeriod(query.period, tz, now, query.from, query.to);
    const prev = previousPeriod(query.period, period, tz);

    const [curRows, prevRows, curCust, prevCust, repeat, totalCustomers, topProducts, topCategories, currency, lastSyncedAt] =
      await Promise.all([
        this.dailyRows(organizationId, period, tz),
        this.dailyRows(organizationId, prev, tz),
        this.customerAgg(organizationId, period),
        this.customerAgg(organizationId, prev),
        this.repeatLifetime(organizationId),
        this.prisma.customer.count({ where: { organizationId, deletedAt: null, mergedIntoId: null } }),
        this.topProducts(organizationId, period),
        this.topCategories(organizationId, period),
        this.currencyFor(organizationId),
        this.lastSyncedAt(organizationId),
      ]);

    const curAgg: KpiCustomerAgg = { ...curCust, ...repeat, totalCustomers };
    const prevAgg: KpiCustomerAgg = { ...prevCust, ...repeat, totalCustomers };

    const metrics = buildKpiMetrics(sumDaily(curRows), curAgg, sumDaily(prevRows), prevAgg);

    const payload: KpiResponse = {
      period: {
        preset: query.period,
        start: period.start.toISOString(),
        end: period.end.toISOString(),
        timezone: tz,
      },
      previousPeriod: { start: prev.start.toISOString(), end: prev.end.toISOString() },
      currency,
      lastSyncedAt,
      metrics,
      trend: this.buildTrend(curRows, period, tz, query.interval),
      topProducts,
      topCategories,
    };

    await this.redis.cacheSet(cacheKey, payload, CACHE_TTL_SECONDS);
    return payload;
  }

  // ----- data access ------------------------------------------------------

  /** Read the daily rollup rows for `[period)` (filtered by the view's local day). */
  private async dailyRows(organizationId: string, period: Period, tz: string): Promise<DailyWithDay[]> {
    const startYmd = ymd(period.start, tz);
    const endYmd = ymd(period.end, tz);
    const rows = await this.prisma.$queryRaw<RawDaily[]>`
      SELECT day, net_minor, gross_minor, refunded_minor, discount_minor,
             order_count, refund_order_count, discount_order_count, new_customer_count
      FROM commerce_kpi_daily
      WHERE organization_id = ${organizationId}
        AND day >= ${startYmd}::date AND day < ${endYmd}::date
      ORDER BY day ASC`;
    return rows.map((r) => ({
      net_minor: Number(r.net_minor),
      gross_minor: Number(r.gross_minor),
      refunded_minor: Number(r.refunded_minor),
      discount_minor: Number(r.discount_minor),
      order_count: r.order_count,
      refund_order_count: r.refund_order_count,
      discount_order_count: r.discount_order_count,
      new_customer_count: r.new_customer_count,
      _day: r.day.toISOString().slice(0, 10), // UTC ISO of the local `date` (midnight) → YYYY-MM-DD
    }));
  }

  /** Active + returning customers for a period (returning = had an earlier order). */
  private async customerAgg(
    organizationId: string,
    period: Period,
  ): Promise<Pick<KpiCustomerAgg, 'activeCustomers' | 'returningCustomers'>> {
    const rows = await this.prisma.$queryRaw<Array<{ active: number; returning: number }>>`
      WITH ip AS (
        SELECT "customerId" AS cid
        FROM "Order"
        WHERE "organizationId" = ${organizationId} AND "deletedAt" IS NULL
          AND status IN ('PAID','FULFILLED') AND "customerId" IS NOT NULL
          AND "placedAt" >= ${period.start} AND "placedAt" < ${period.end}
        GROUP BY "customerId"
      ),
      fe AS (
        SELECT "customerId" AS cid, MIN("placedAt") AS first_at
        FROM "Order"
        WHERE "organizationId" = ${organizationId} AND "deletedAt" IS NULL
          AND status IN ('PAID','FULFILLED')
          AND "customerId" IN (SELECT cid FROM ip)
        GROUP BY "customerId"
      )
      SELECT COUNT(*)::int AS active,
             COUNT(*) FILTER (WHERE fe.first_at < ${period.start})::int AS returning
      FROM ip JOIN fe ON fe.cid = ip.cid`;
    const r = rows[0] ?? { active: 0, returning: 0 };
    return { activeCustomers: r.active, returningCustomers: r.returning };
  }

  /** Lifetime repeat: buyers (≥1) + repeat buyers (≥2), from denormalized features. */
  private async repeatLifetime(
    organizationId: string,
  ): Promise<Pick<KpiCustomerAgg, 'buyersLifetime' | 'repeatBuyersLifetime'>> {
    const rows = await this.prisma.$queryRaw<Array<{ buyers: number; repeat: number }>>`
      SELECT COUNT(*) FILTER (WHERE "orderCount" >= 1)::int AS buyers,
             COUNT(*) FILTER (WHERE "orderCount" >= 2)::int AS repeat
      FROM "CustomerFeatures" WHERE "organizationId" = ${organizationId}`;
    const r = rows[0] ?? { buyers: 0, repeat: 0 };
    return { buyersLifetime: r.buyers, repeatBuyersLifetime: r.repeat };
  }

  /** Top products by (gross line) revenue in the period, from order line items. */
  private async topProducts(organizationId: string, period: Period): Promise<KpiTopProduct[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ product_id: string | null; title: string; revenue_minor: bigint; units: number }>
    >`
      SELECT oi."productId" AS product_id, oi.title AS title,
             SUM(oi."priceMinor" * oi.quantity)::bigint AS revenue_minor,
             SUM(oi.quantity)::int AS units
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      WHERE o."organizationId" = ${organizationId} AND o."deletedAt" IS NULL
        AND o.status IN ('PAID','FULFILLED')
        AND o."placedAt" >= ${period.start} AND o."placedAt" < ${period.end}
      GROUP BY oi."productId", oi.title
      ORDER BY revenue_minor DESC
      LIMIT 8`;
    return rows.map((r) => ({
      productId: r.product_id,
      title: r.title || 'Untitled',
      revenueMinor: Number(r.revenue_minor),
      units: r.units,
    }));
  }

  /** Top categories by revenue in the period, from line items → Product.productType. */
  private async topCategories(organizationId: string, period: Period): Promise<KpiTopCategory[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ category: string | null; revenue_minor: bigint; units: number }>
    >`
      SELECT COALESCE(NULLIF(p."productType", ''), 'Uncategorized') AS category,
             SUM(oi."priceMinor" * oi.quantity)::bigint AS revenue_minor,
             SUM(oi.quantity)::int AS units
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      LEFT JOIN "Product" p ON p.id = oi."productId"
      WHERE o."organizationId" = ${organizationId} AND o."deletedAt" IS NULL
        AND o.status IN ('PAID','FULFILLED')
        AND o."placedAt" >= ${period.start} AND o."placedAt" < ${period.end}
      GROUP BY COALESCE(NULLIF(p."productType", ''), 'Uncategorized')
      ORDER BY revenue_minor DESC
      LIMIT 8`;
    return rows.map((r) => ({
      category: r.category ?? 'Uncategorized',
      revenueMinor: Number(r.revenue_minor),
      units: r.units,
    }));
  }

  private async currencyFor(organizationId: string): Promise<string | null> {
    const row = await this.prisma.order.findFirst({
      where: { organizationId, deletedAt: null },
      select: { currency: true },
      orderBy: { placedAt: 'desc' },
    });
    return row?.currency ?? null;
  }

  private async lastSyncedAt(organizationId: string): Promise<string | null> {
    const integ = await this.prisma.integration.findUnique({
      where: { organizationId_provider: { organizationId, provider: 'shopify' } },
      select: { lastSyncedAt: true },
    });
    return integ?.lastSyncedAt ? integ.lastSyncedAt.toISOString() : null;
  }

  // ----- trend bucketing --------------------------------------------------

  /** Bucket the period's daily rows into day/week/month trend points. */
  private buildTrend(
    rows: DailyWithDay[],
    period: Period,
    tz: string,
    requested?: 'day' | 'week' | 'month',
  ): KpiTrendPoint[] {
    const days = Math.round((period.end.getTime() - period.start.getTime()) / 86_400_000);
    const interval = requested ?? (days <= 45 ? 'day' : days <= 130 ? 'week' : 'month');

    if (interval === 'day') {
      return rows.map((r) => ({
        start: r._day,
        end: r._day,
        netRevenueMinor: r.net_minor,
        orderCount: r.order_count,
        newCustomers: r.new_customer_count,
      }));
    }

    return generateBuckets(period, interval, tz).map((b) => {
      const sLabel = ymd(b.start, tz);
      const eLabel = ymd(b.end, tz);
      const inBucket = rows.filter((r) => r._day >= sLabel && r._day < eLabel);
      const sum = sumDaily(inBucket);
      return { start: sLabel, end: eLabel, netRevenueMinor: sum.netMinor, orderCount: sum.orderCount, newCustomers: sum.newCustomers };
    });
  }
}

/** Local calendar date (org tz) of a UTC instant, as 'YYYY-MM-DD'. */
function ymd(date: Date, tz: string): string {
  const { year, month, day } = localYmd(date, tz);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
