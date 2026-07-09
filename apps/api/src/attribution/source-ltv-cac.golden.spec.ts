import { PrismaClient, Prisma } from '@prisma/client';
import { AttributionService } from './attribution.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * GOLDEN LTV:CAC / payback. Seeds a known set of first-touch touchpoints + orders
 * + Meta spend, refreshes the REAL source_ltv_cac materialized view, and asserts
 * EXACT hand-computed CAC / LTV / LTV:CAC / payback + coverage + Meta-vs-store
 * reconciliation. Wrong money math FAILS here.
 *
 * DB-backed: requires Postgres + the migration applied (as in CI + local dev).
 */
jest.setTimeout(60_000);

const prisma = new PrismaClient();
const attribution = new AttributionService(prisma as unknown as PrismaService);
const SLUG = 'golden-ltvcac';

let orgId: string;

beforeAll(async () => {
  await prisma.organization.deleteMany({ where: { slug: SLUG } });
  const org = await prisma.organization.create({ data: { name: 'Golden LTV:CAC', slug: SLUG } });
  orgId = org.id;

  // 5 customers: 3 first-touch Meta, 1 google, 1 unknown.
  const ids = ['M1', 'M2', 'M3', 'G1', 'U1'];
  await prisma.customer.createMany({ data: ids.map((id) => ({ id: `${orgId}_${id}`, organizationId: orgId, externalId: `ext_${id}`, firstName: id })) });

  // Touchpoints (first-touch source). Meta customers via a meta touchpoint.
  const tp = (c: string, channel: string, source: string, when: string): Prisma.TouchpointCreateManyInput => ({
    organizationId: orgId, customerId: `${orgId}_${c}`, channel, source, sessionId: `${c}_sess`, occurredAt: new Date(when),
  });
  await prisma.touchpoint.createMany({
    data: [
      tp('M1', 'meta', 'meta', '2026-06-01T00:00:00Z'),
      tp('M2', 'meta', 'meta', '2026-06-02T00:00:00Z'),
      tp('M3', 'meta', 'meta', '2026-06-03T00:00:00Z'),
      tp('G1', 'web', 'google', '2026-06-04T00:00:00Z'),
      tp('U1', 'web', 'unknown', '2026-06-05T00:00:00Z'),
    ],
  });

  // Orders (all PAID, all in June → active_months = 1 for every source).
  const ord = (c: string, ext: string, total: number, day: string): Prisma.OrderCreateManyInput => ({
    organizationId: orgId, externalId: ext, customerId: `${orgId}_${c}`, orderNumber: ext, status: 'PAID', financialStatus: 'PAID', totalMinor: total, currency: 'INR', placedAt: new Date(day),
  });
  await prisma.order.createMany({
    data: [
      ord('M1', 'lo1', 1000, '2026-06-06T00:00:00Z'), // meta net 6000 across M1..M3
      ord('M2', 'lo2', 2000, '2026-06-07T00:00:00Z'),
      ord('M3', 'lo3', 3000, '2026-06-08T00:00:00Z'),
      ord('G1', 'lo4', 5000, '2026-06-09T00:00:00Z'), // google, no spend
      ord('U1', 'lo5', 1000, '2026-06-10T00:00:00Z'), // unknown, no spend
    ],
  });

  // Meta spend ₹30 (3000 paise) at campaign level; 10 Meta-reported conversions.
  await prisma.adMetricDaily.create({
    data: { organizationId: orgId, entityType: 'campaign', entityId: 'cmp1', date: new Date('2026-06-01T00:00:00Z'), spendMinor: 3000, impressions: 5000, clicks: 200, conversions: 10, currency: 'INR' },
  });

  await prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW source_ltv_cac');
  await prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW ad_performance');
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { slug: SLUG } });
  await prisma.$disconnect();
});

describe('source_ltv_cac golden', () => {
  it('Meta source: CAC 1000, avg LTV 2000, LTV:CAC 2.0, payback 0.5 (hand-computed)', async () => {
    const roi = await attribution.sourceRoi(orgId, 'first_touch');
    const meta = roi.data.find((r) => r.source === 'meta')!;
    expect(meta).toBeDefined();
    expect({
      customersAcquired: meta.customersAcquired,
      ltvTotalMinor: meta.ltvTotalMinor,
      avgLtvMinor: meta.avgLtvMinor,
      spendMinor: meta.spendMinor,
      cacMinor: meta.cacMinor,
      ltvCacRatio: meta.ltvCacRatio,
      paybackMonths: meta.paybackMonths,
    }).toEqual({
      customersAcquired: 3,
      ltvTotalMinor: 6000,
      avgLtvMinor: 2000,
      spendMinor: 3000,
      cacMinor: 1000,
      ltvCacRatio: 2,
      paybackMonths: 0.5,
    });
    expect(roi.model).toBe('first_touch'); // model is labelled
  });

  it('organic sources have no spend → CAC / ratio / payback are null (never fabricated)', async () => {
    const roi = await attribution.sourceRoi(orgId, 'first_touch');
    const google = roi.data.find((r) => r.source === 'google')!;
    expect(google.ltvTotalMinor).toBe(5000);
    expect(google.cacMinor).toBeNull();
    expect(google.ltvCacRatio).toBeNull();
    expect(google.paybackMonths).toBeNull();
  });

  it('coverage = 4/5 known first-touch = 80% (unknown is honestly counted)', async () => {
    expect(await attribution.coveragePct(orgId)).toBe(80);
  });

  it('reconciliation shows Meta OVER-reporting: 10 reported vs 3 store-actual orders; revenue is store-actual', async () => {
    const rec = await attribution.reconciliation(orgId);
    expect(rec.metaReportedConversions).toBe(10);
    expect(rec.storeActualOrders).toBe(3);
    expect(rec.storeActualRevenueMinor).toBe(6000); // net of the 3 meta customers
  });
});
