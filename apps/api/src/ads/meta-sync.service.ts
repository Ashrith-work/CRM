import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerPiiService } from '../customers/customer-pii.service';
import { MetaService, type MetaConn } from './meta.service';
import { mapAd, mapAdSet, mapCampaign, mapCreative, mapInsight, mapLead, type MappedMetric } from './meta.mappers';

/**
 * Persists the Meta hierarchy + daily metrics + Lead-Ads (idempotent). Separated
 * from the worker so the persistence math (idempotent upsert, creative rollup,
 * lead → customer conversion) is unit-testable without BullMQ.
 */
@Injectable()
export class MetaSyncService {
  private readonly logger = new Logger(MetaSyncService.name);
  private static readonly METRIC_WINDOW_DAYS = 7;

  constructor(
    private readonly prisma: PrismaService,
    private readonly meta: MetaService,
    private readonly pii: CustomerPiiService,
  ) {}

  /** Pull the hierarchy + daily insights for a connected org. Returns counts. */
  async pullMetrics(organizationId: string, conn: MetaConn, now = new Date()): Promise<{ entities: number; metrics: number }> {
    // Hierarchy (idempotent upserts on (org, externalId)).
    const [campaigns, adsets, ads, creatives] = await Promise.all([
      this.meta.listEdge(conn, 'campaigns', 'id,name,status,objective'),
      this.meta.listEdge(conn, 'adsets', 'id,name,status,campaign_id'),
      this.meta.listEdge(conn, 'ads', 'id,name,status,adset_id,creative{id}'),
      this.meta.listEdge(conn, 'adcreatives', 'id,name,thumbnail_url'),
    ]);
    let entities = 0;
    for (const raw of campaigns) { const c = mapCampaign(raw); await this.prisma.adCampaign.upsert({ where: { organizationId_externalId: { organizationId, externalId: c.externalId } }, update: { name: c.name, status: c.status, objective: c.objective ?? null }, create: { organizationId, externalId: c.externalId, name: c.name, status: c.status, objective: c.objective ?? null } }); entities++; }
    for (const raw of adsets) { const a = mapAdSet(raw); await this.prisma.adSet.upsert({ where: { organizationId_externalId: { organizationId, externalId: a.externalId } }, update: { name: a.name, status: a.status, campaignExternalId: a.campaignExternalId ?? null }, create: { organizationId, externalId: a.externalId, name: a.name, status: a.status, campaignExternalId: a.campaignExternalId ?? null } }); entities++; }
    const adToCreative = new Map<string, string>();
    for (const raw of ads) { const a = mapAd(raw); if (a.creativeExternalId) adToCreative.set(a.externalId, a.creativeExternalId); await this.prisma.ad.upsert({ where: { organizationId_externalId: { organizationId, externalId: a.externalId } }, update: { name: a.name, status: a.status, adsetExternalId: a.adsetExternalId ?? null, creativeExternalId: a.creativeExternalId ?? null }, create: { organizationId, externalId: a.externalId, name: a.name, status: a.status, adsetExternalId: a.adsetExternalId ?? null, creativeExternalId: a.creativeExternalId ?? null } }); entities++; }
    for (const raw of creatives) { const c = mapCreative(raw); await this.prisma.adCreative.upsert({ where: { organizationId_externalId: { organizationId, externalId: c.externalId } }, update: { name: c.name, thumbnailUrl: c.thumbnailUrl ?? null }, create: { organizationId, externalId: c.externalId, name: c.name, thumbnailUrl: c.thumbnailUrl ?? null } }); entities++; }

    // Currency for spend rows comes from the ad account (set at connect).
    const account = await this.prisma.adAccount.findFirst({ where: { organizationId }, select: { currency: true } });
    const currency = account?.currency;

    // Daily insights for the rolling window (campaign/adset/ad).
    const until = ymd(now);
    const since = ymd(new Date(now.getTime() - MetaSyncService.METRIC_WINDOW_DAYS * 86_400_000));
    let metrics = 0;
    const adMetrics: MappedMetric[] = [];
    for (const level of ['campaign', 'adset', 'ad'] as const) {
      const rows = await this.meta.insights(conn, level, since, until);
      for (const raw of rows) {
        const m = mapInsight(level, raw);
        if (!m) continue;
        await this.upsertMetric(organizationId, m, currency);
        metrics++;
        if (level === 'ad') adMetrics.push(m);
      }
    }
    // Creative-level rollup: sum each ad's daily metrics into its creative.
    metrics += await this.rollupCreativeMetrics(organizationId, adMetrics, adToCreative, currency);
    return { entities, metrics };
  }

  /** Idempotent upsert on the UNIQUE(org, entityType, entityId, date) key. */
  async upsertMetric(organizationId: string, m: MappedMetric, currency?: string): Promise<void> {
    const data = { spendMinor: m.spendMinor, impressions: m.impressions, clicks: m.clicks, conversions: m.conversions, ...(currency ? { currency } : {}) };
    await this.prisma.adMetricDaily.upsert({
      where: { organizationId_entityType_entityId_date: { organizationId, entityType: m.entityType, entityId: m.entityId, date: m.date } },
      update: data,
      create: { organizationId, entityType: m.entityType, entityId: m.entityId, date: m.date, ...data },
    });
  }

  private async rollupCreativeMetrics(organizationId: string, adMetrics: MappedMetric[], adToCreative: Map<string, string>, currency?: string): Promise<number> {
    const byCreativeDate = new Map<string, MappedMetric>();
    for (const m of adMetrics) {
      const creativeId = adToCreative.get(m.entityId);
      if (!creativeId) continue;
      const key = `${creativeId}|${m.date.toISOString()}`;
      const agg = byCreativeDate.get(key) ?? { entityType: 'creative', entityId: creativeId, date: m.date, spendMinor: 0, impressions: 0, clicks: 0, conversions: 0 };
      agg.spendMinor += m.spendMinor;
      agg.impressions += m.impressions;
      agg.clicks += m.clicks;
      agg.conversions += m.conversions;
      byCreativeDate.set(key, agg);
    }
    for (const m of byCreativeDate.values()) await this.upsertMetric(organizationId, m, currency);
    return byCreativeDate.size;
  }

  // ----- Lead-Ads ---------------------------------------------------------
  async pullLeads(organizationId: string, conn: MetaConn): Promise<{ imported: number; converted: number }> {
    const forms = await this.meta.leadForms(conn);
    let imported = 0;
    for (const form of forms) {
      const formId = String(form.id);
      const leads = await this.meta.formLeads(conn, formId);
      for (const raw of leads) {
        const lead = mapLead(raw);
        // First-touch touchpoint for the lead (customer linked on conversion).
        const tp = await this.prisma.touchpoint.upsert({
          where: { organizationId_channel_sessionId: { organizationId, channel: 'meta', sessionId: lead.externalId } },
          update: { source: 'meta', campaign: lead.campaign, adset: lead.adset, creative: lead.ad, occurredAt: lead.occurredAt },
          create: { organizationId, channel: 'meta', sessionId: lead.externalId, source: 'meta', campaign: lead.campaign, adset: lead.adset, creative: lead.ad, occurredAt: lead.occurredAt },
        });
        await this.prisma.adLead.upsert({
          where: { organizationId_externalId: { organizationId, externalId: lead.externalId } },
          update: { name: lead.name, email: lead.email, phone: lead.phone, formId: lead.formId, campaign: lead.campaign, adset: lead.adset, ad: lead.ad, firstTouchTouchpointId: tp.id, occurredAt: lead.occurredAt },
          create: { organizationId, externalId: lead.externalId, name: lead.name, email: lead.email, phone: lead.phone, source: 'meta', formId: lead.formId, campaign: lead.campaign, adset: lead.adset, ad: lead.ad, firstTouchTouchpointId: tp.id, occurredAt: lead.occurredAt },
        });
        imported++;
      }
    }
    const converted = await this.linkLeadConversions(organizationId);
    return { imported, converted };
  }

  /**
   * Convert NEW leads that now match a purchasing customer (first purchase):
   * set convertedCustomerId + status, and RE-ATTRIBUTE by pointing the lead's
   * first-touch Meta touchpoint at that customer (so first-touch credits Meta).
   */
  async linkLeadConversions(organizationId: string): Promise<number> {
    const leads = await this.prisma.adLead.findMany({
      where: { organizationId, status: 'NEW', OR: [{ email: { not: null } }, { phone: { not: null } }] },
    });
    let converted = 0;
    for (const lead of leads) {
      // Match on the deterministic hashes (email/phone are encrypted at rest).
      const emailHash = this.pii.emailHashOf(lead.email);
      const phoneHash = this.pii.phoneHashOf(lead.phone);
      const or: Array<Record<string, string>> = [];
      if (emailHash) or.push({ emailHash });
      if (phoneHash) or.push({ phoneHash });
      if (or.length === 0) continue;

      const customer = await this.prisma.customer.findFirst({
        where: { organizationId, deletedAt: null, mergedIntoId: null, OR: or },
        select: { id: true },
      });
      if (!customer) continue;
      // First purchase check: at least one paid/fulfilled order.
      const paid = await this.prisma.order.count({ where: { organizationId, customerId: customer.id, deletedAt: null, status: { in: ['PAID', 'FULFILLED'] } } });
      if (paid === 0) continue;

      await this.prisma.adLead.update({ where: { id: lead.id }, data: { status: 'CONVERTED', convertedCustomerId: customer.id } });
      if (lead.firstTouchTouchpointId) {
        await this.prisma.touchpoint.update({ where: { id: lead.firstTouchTouchpointId }, data: { customerId: customer.id } });
      }
      converted++;
    }
    return converted;
  }
}

/** UTC YYYY-MM-DD for the Insights time_range. */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
