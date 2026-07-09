import { Injectable, Logger } from '@nestjs/common';
import type {
  AdPerformanceResponse,
  AttributionModel,
  ReconciliationResponse,
  SourceRoiResponse,
  SourceRoiRow,
} from '@crm/types';
import { PrismaService } from '../prisma/prisma.service';
import { firstTouchSource } from './utm.util';

interface FirstTouchViewRow {
  source: string;
  customers_acquired: number;
  ltv_total_minor: bigint | number;
  avg_ltv_minor: bigint | number;
  spend_minor: bigint | number;
  cac_minor: bigint | number | null;
  ltv_cac_ratio: string | number | null;
  payback_months: string | number | null;
}

/**
 * First-touch attribution + LTV-by-source (Part 9). We bucket acquisition on
 * FIRST-touch by default but store every touchpoint and support selectable
 * models — the UI labels the model. Revenue is store-actual; Meta-reported
 * conversions are reconciled against store-actual orders (Meta over-reports).
 */
@Injectable()
export class AttributionService {
  private readonly logger = new Logger(AttributionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Capture a WEB touchpoint per order from its stored attributes (Part 9 —
   * every touchpoint). Idempotent on (org, channel='web', sessionId=orderExtId).
   * Orders without UTMs get source "unknown" so coverage stays honest.
   */
  async captureOrderTouchpoints(organizationId: string): Promise<number> {
    const orders = await this.prisma.order.findMany({
      where: { organizationId, deletedAt: null, customerId: { not: null } },
      select: { externalId: true, customerId: true, placedAt: true, attributes: true },
    });
    let n = 0;
    for (const o of orders) {
      const source = firstTouchSource(o.attributes);
      const attrs = (o.attributes ?? null) as { utm?: { campaign?: string } } | null;
      await this.prisma.touchpoint.upsert({
        where: { organizationId_channel_sessionId: { organizationId, channel: 'web', sessionId: o.externalId } },
        update: { customerId: o.customerId, source, occurredAt: o.placedAt },
        create: {
          organizationId,
          customerId: o.customerId,
          channel: 'web',
          sessionId: o.externalId,
          source,
          campaign: attrs?.utm?.campaign ?? null,
          utm: (o.attributes ?? undefined) as never,
          occurredAt: o.placedAt,
        },
      });
      n += 1;
    }
    return n;
  }

  // ----- source ROI -------------------------------------------------------
  async sourceRoi(organizationId: string, model: AttributionModel = 'first_touch'): Promise<SourceRoiResponse> {
    const currency = await this.currencyFor(organizationId);
    const coveragePct = await this.coveragePct(organizationId);
    const data = model === 'first_touch'
      ? await this.firstTouchRoi(organizationId)
      : await this.modeledRoi(organizationId, model);
    return { model, currency, coveragePct, data };
  }

  /** Fast path: read the deterministic source_ltv_cac materialized view. */
  private async firstTouchRoi(organizationId: string): Promise<SourceRoiRow[]> {
    const rows = await this.prisma.$queryRaw<FirstTouchViewRow[]>`
      SELECT source, customers_acquired, ltv_total_minor, avg_ltv_minor, spend_minor, cac_minor, ltv_cac_ratio, payback_months
      FROM source_ltv_cac WHERE organization_id = ${organizationId} ORDER BY spend_minor DESC, source ASC`;
    return rows.map((r) => {
      const spend = Number(r.spend_minor);
      const ltvTotal = Number(r.ltv_total_minor);
      const ratio = r.ltv_cac_ratio == null ? null : Number(r.ltv_cac_ratio);
      return {
        source: r.source,
        customersAcquired: r.customers_acquired,
        spendMinor: spend,
        ltvTotalMinor: ltvTotal,
        avgLtvMinor: Number(r.avg_ltv_minor),
        cacMinor: r.cac_minor == null ? null : Number(r.cac_minor),
        ltvCacRatio: ratio,
        paybackMonths: r.payback_months == null ? null : Number(r.payback_months),
        roas: spend > 0 ? Number((ltvTotal / spend).toFixed(4)) : null,
      };
    });
  }

  /**
   * Selectable models (last/linear/time-decay) computed from every touchpoint —
   * credit is distributed per model, then LTV/CAC/payback are derived. Labelled
   * in the UI so a modeled number is never mistaken for first-touch truth.
   */
  private async modeledRoi(organizationId: string, model: AttributionModel): Promise<SourceRoiRow[]> {
    const touchpoints = await this.prisma.touchpoint.findMany({
      where: { organizationId, customerId: { not: null } },
      select: { customerId: true, source: true, occurredAt: true },
      orderBy: { occurredAt: 'asc' },
    });
    const ltvByCustomer = await this.ltvByCustomer(organizationId);
    const spendBySource = await this.spendBySource(organizationId);
    const monthsBySource = await this.activeMonthsBySource(organizationId);

    // Group ordered sources per customer.
    const byCustomer = new Map<string, string[]>();
    for (const t of touchpoints) {
      const list = byCustomer.get(t.customerId!) ?? [];
      list.push(t.source);
      byCustomer.set(t.customerId!, list);
    }

    const acc = new Map<string, { acquired: number; ltvTotal: number }>();
    for (const [customerId, sources] of byCustomer) {
      const ltv = ltvByCustomer.get(customerId) ?? 0;
      for (const [source, weight] of creditWeights(sources, model)) {
        const a = acc.get(source) ?? { acquired: 0, ltvTotal: 0 };
        a.acquired += weight;
        a.ltvTotal += weight * ltv;
        acc.set(source, a);
      }
    }

    const rows: SourceRoiRow[] = [];
    for (const [source, a] of acc) {
      const spend = spendBySource.get(source) ?? 0;
      const acquired = a.acquired;
      const ltvTotal = Math.round(a.ltvTotal);
      const months = monthsBySource.get(source) ?? 1;
      rows.push({
        source,
        customersAcquired: Math.round(acquired),
        spendMinor: spend,
        ltvTotalMinor: ltvTotal,
        avgLtvMinor: acquired > 0 ? Math.round(ltvTotal / acquired) : 0,
        cacMinor: spend > 0 && acquired > 0 ? Math.round(spend / acquired) : null,
        ltvCacRatio: spend > 0 ? Number((ltvTotal / spend).toFixed(4)) : null,
        paybackMonths: spend > 0 && ltvTotal > 0 ? Number(((spend * Math.max(months, 1)) / ltvTotal).toFixed(2)) : null,
        roas: spend > 0 ? Number((ltvTotal / spend).toFixed(4)) : null,
      });
    }
    return rows.sort((x, y) => y.spendMinor - x.spendMinor || x.source.localeCompare(y.source));
  }

  // ----- coverage ---------------------------------------------------------
  /** Share of acquired customers whose first-touch source is known (not unknown). */
  async coveragePct(organizationId: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ source: string }>>`
      SELECT DISTINCT ON (t."customerId") t.source
      FROM "Touchpoint" t
      WHERE t."organizationId" = ${organizationId} AND t."customerId" IS NOT NULL
      ORDER BY t."customerId", t."occurredAt" ASC, t.id ASC`;
    if (rows.length === 0) return 0;
    const known = rows.filter((r) => r.source && r.source !== 'unknown').length;
    return Number(((known / rows.length) * 100).toFixed(1));
  }

  // ----- reconciliation (Meta-reported vs store-actual) -------------------
  async reconciliation(organizationId: string): Promise<ReconciliationResponse> {
    const metaAgg = await this.prisma.adMetricDaily.aggregate({
      where: { organizationId, entityType: 'campaign' },
      _sum: { conversions: true },
    });
    // Store-actual: paid/fulfilled orders for first-touch-Meta customers.
    const store = await this.prisma.$queryRaw<Array<{ orders: bigint; revenue: bigint | null }>>`
      WITH first_touch AS (
        SELECT DISTINCT ON (t."customerId") t."customerId" AS customer_id, t.source
        FROM "Touchpoint" t
        WHERE t."organizationId" = ${organizationId} AND t."customerId" IS NOT NULL
        ORDER BY t."customerId", t."occurredAt" ASC, t.id ASC
      )
      SELECT COUNT(o.id)::bigint AS orders,
             COALESCE(SUM(o."totalMinor" - o."refundedMinor"), 0)::bigint AS revenue
      FROM "Order" o
      JOIN first_touch ft ON ft.customer_id = o."customerId" AND ft.source = 'meta'
      WHERE o."organizationId" = ${organizationId} AND o."deletedAt" IS NULL AND o.status IN ('PAID','FULFILLED')`;
    const currency = await this.currencyFor(organizationId);
    return {
      metaReportedConversions: metaAgg._sum.conversions ?? 0,
      storeActualOrders: Number(store[0]?.orders ?? 0),
      storeActualRevenueMinor: Number(store[0]?.revenue ?? 0),
      currency,
      note: 'Meta typically over-reports conversions (view-through + cross-device). Revenue uses store-actual paid/fulfilled orders for first-touch-Meta customers.',
    };
  }

  // ----- ad performance ---------------------------------------------------
  async adPerformance(organizationId: string): Promise<AdPerformanceResponse> {
    const rows = await this.prisma.$queryRaw<Array<{ entity_type: string; entity_id: string; spend_minor: bigint; impressions: bigint; clicks: bigint; conversions: bigint; ctr: string | number; cpc_minor: bigint }>>`
      SELECT entity_type, entity_id, spend_minor, impressions, clicks, conversions, ctr, cpc_minor
      FROM ad_performance WHERE organization_id = ${organizationId} ORDER BY spend_minor DESC`;
    const names = await this.entityNames(organizationId);
    const currency = await this.currencyFor(organizationId);
    return {
      currency,
      data: rows.map((r) => ({
        entityType: r.entity_type as AdPerformanceResponse['data'][number]['entityType'],
        entityId: r.entity_id,
        name: names.get(`${r.entity_type}:${r.entity_id}`) ?? r.entity_id,
        spendMinor: Number(r.spend_minor),
        impressions: Number(r.impressions),
        clicks: Number(r.clicks),
        conversions: Number(r.conversions),
        ctr: Number(r.ctr),
        cpcMinor: Number(r.cpc_minor),
      })),
    };
  }

  // ----- helpers ----------------------------------------------------------
  private async currencyFor(organizationId: string): Promise<string | null> {
    const m = await this.prisma.adMetricDaily.findFirst({ where: { organizationId }, select: { currency: true } });
    if (m?.currency) return m.currency;
    const c = await this.prisma.customerFeatures.findFirst({ where: { organizationId, currency: { not: null } }, select: { currency: true } });
    return c?.currency ?? null;
  }

  private async ltvByCustomer(organizationId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<Array<{ customer_id: string; net: bigint }>>`
      SELECT o."customerId" AS customer_id, SUM(o."totalMinor" - o."refundedMinor")::bigint AS net
      FROM "Order" o
      WHERE o."organizationId" = ${organizationId} AND o."customerId" IS NOT NULL AND o."deletedAt" IS NULL AND o.status IN ('PAID','FULFILLED')
      GROUP BY o."customerId"`;
    return new Map(rows.map((r) => [r.customer_id, Number(r.net)]));
  }

  private async spendBySource(organizationId: string): Promise<Map<string, number>> {
    const agg = await this.prisma.adMetricDaily.aggregate({ where: { organizationId, entityType: 'campaign' }, _sum: { spendMinor: true } });
    const meta = agg._sum.spendMinor ?? 0;
    return new Map(meta > 0 ? [['meta', meta]] : []);
  }

  private async activeMonthsBySource(organizationId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<Array<{ source: string; months: bigint }>>`
      WITH first_touch AS (
        SELECT DISTINCT ON (t."customerId") t."customerId" AS customer_id, t.source
        FROM "Touchpoint" t
        WHERE t."organizationId" = ${organizationId} AND t."customerId" IS NOT NULL
        ORDER BY t."customerId", t."occurredAt" ASC, t.id ASC
      )
      SELECT ft.source, COUNT(DISTINCT date_trunc('month', o."placedAt"))::bigint AS months
      FROM first_touch ft
      JOIN "Order" o ON o."organizationId" = ${organizationId} AND o."customerId" = ft.customer_id AND o."deletedAt" IS NULL AND o.status IN ('PAID','FULFILLED')
      GROUP BY ft.source`;
    return new Map(rows.map((r) => [r.source, Math.max(Number(r.months), 1)]));
  }

  private async entityNames(organizationId: string): Promise<Map<string, string>> {
    const [campaigns, adsets, ads, creatives] = await Promise.all([
      this.prisma.adCampaign.findMany({ where: { organizationId }, select: { externalId: true, name: true } }),
      this.prisma.adSet.findMany({ where: { organizationId }, select: { externalId: true, name: true } }),
      this.prisma.ad.findMany({ where: { organizationId }, select: { externalId: true, name: true } }),
      this.prisma.adCreative.findMany({ where: { organizationId }, select: { externalId: true, name: true } }),
    ]);
    const m = new Map<string, string>();
    for (const c of campaigns) m.set(`campaign:${c.externalId}`, c.name);
    for (const a of adsets) m.set(`adset:${a.externalId}`, a.name);
    for (const a of ads) m.set(`ad:${a.externalId}`, a.name);
    for (const c of creatives) m.set(`creative:${c.externalId}`, c.name);
    return m;
  }
}

/**
 * Per-customer credit weights by model, given the ORDERED list of touchpoint
 * sources (earliest→latest). Weights sum to 1 across a customer.
 */
export function creditWeights(sources: string[], model: AttributionModel): Array<[string, number]> {
  if (sources.length === 0) return [];
  if (model === 'first_touch') return [[sources[0], 1]];
  if (model === 'last_touch') return [[sources[sources.length - 1], 1]];

  // linear + time_decay distribute across ALL touchpoints (then fold by source).
  const weights = sources.map((_, i) =>
    model === 'time_decay' ? 2 ** i : 1, // time_decay favors later touchpoints
  );
  const total = weights.reduce((s, w) => s + w, 0);
  const bySource = new Map<string, number>();
  sources.forEach((s, i) => bySource.set(s, (bySource.get(s) ?? 0) + weights[i] / total));
  return [...bySource.entries()];
}
