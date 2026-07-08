import { PrismaClient, Prisma } from '@prisma/client';
import { RfmRefreshService } from './rfm-refresh.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * GOLDEN-DATASET TEST (non-negotiable). Seeds a known set of customers/orders
 * with HAND-COMPUTED expected RFM — including a refund case (monetary must
 * subtract the refund), a single-order customer, mixed paid/fulfilled statuses,
 * and a zero-order customer (excluded) — then runs the REAL customer_rfm
 * materialized view + refresh worker and asserts EXACT scores/segment/net.
 * Wrong numbers FAIL here rather than slipping through.
 *
 * DB-backed: requires Postgres + the migration applied (as in CI + local dev).
 */
jest.setTimeout(60_000); // DB setup (REFRESH view + writes) can be slow under parallel load.

const prisma = new PrismaClient();
const rfm = new RfmRefreshService(prisma as unknown as PrismaService);
const SLUG = 'golden-rfm';
const NOW = new Date('2026-06-01T00:00:00Z');

const DATE: Record<string, Date> = {
  A: new Date('2026-01-01T00:00:00Z'),
  B: new Date('2026-02-01T00:00:00Z'),
  C: new Date('2026-03-01T00:00:00Z'),
  D: new Date('2026-04-01T00:00:00Z'),
  E: new Date('2026-05-01T00:00:00Z'),
  Z: new Date('2026-05-15T00:00:00Z'),
};

let orgId: string;

beforeAll(async () => {
  await prisma.organization.deleteMany({ where: { slug: SLUG } });
  const org = await prisma.organization.create({ data: { name: 'Golden RFM', slug: SLUG } });
  orgId = org.id;

  const cust = (id: string) => ({ id: `${orgId}_${id}`, organizationId: orgId, externalId: `ext_${id}`, firstName: id, lastName: 'Test' });
  await prisma.customer.createMany({ data: ['A', 'B', 'C', 'D', 'E', 'Z'].map(cust) });

  const orders: Prisma.OrderCreateManyInput[] = [];
  const add = (c: string, ext: string, total: number, status: 'PAID' | 'FULFILLED' | 'PENDING', refunded = 0) =>
    orders.push({ organizationId: orgId, externalId: ext, customerId: `${orgId}_${c}`, orderNumber: ext, status, financialStatus: 'PAID', totalMinor: total, refundedMinor: refunded, currency: 'INR', placedAt: DATE[c] });

  // A: 1 paid order → net 1000 (single-order case).
  add('A', 'ga1', 1000, 'PAID');
  // B: 2 paid → net 2000.
  add('B', 'gb1', 1000, 'PAID');
  add('B', 'gb2', 1000, 'PAID');
  // C: 3 orders (mixed paid + fulfilled both count) → net 3000.
  add('C', 'gc1', 1000, 'PAID');
  add('C', 'gc2', 1000, 'PAID');
  add('C', 'gc3', 1000, 'FULFILLED');
  // D: 4 paid → net 5000 (highest monetary).
  add('D', 'gd1', 1250, 'PAID');
  add('D', 'gd2', 1250, 'PAID');
  add('D', 'gd3', 1250, 'PAID');
  add('D', 'gd4', 1250, 'PAID');
  // E: 5 orders, gross 10000, one with a 6000 REFUND → net 4000 (refund subtracts).
  add('E', 'ge1', 2000, 'FULFILLED', 6000);
  add('E', 'ge2', 2000, 'PAID');
  add('E', 'ge3', 2000, 'PAID');
  add('E', 'ge4', 2000, 'PAID');
  add('E', 'ge5', 2000, 'PAID');
  // Z: 1 PENDING order → excluded from RFM entirely (zero scored orders).
  add('Z', 'gz1', 9999, 'PENDING');

  await prisma.order.createMany({ data: orders });

  await rfm.refreshView();
  await rfm.writeFeaturesForOrg(orgId, NOW);
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { slug: SLUG } });
  await prisma.$disconnect();
});

async function features(id: string) {
  return prisma.customerFeatures.findUnique({ where: { organizationId_customerId: { organizationId: orgId, customerId: `${orgId}_${id}` } } });
}

describe('RFM golden dataset', () => {
  const EXPECTED: Record<string, { r: number; f: number; m: number; seg: string; net: number }> = {
    A: { r: 1, f: 1, m: 1, seg: 'Lost', net: 1000 },
    B: { r: 2, f: 2, m: 2, seg: 'About to Sleep', net: 2000 },
    C: { r: 3, f: 3, m: 3, seg: 'Potential Loyalist', net: 3000 },
    D: { r: 4, f: 4, m: 5, seg: 'Champions', net: 5000 },
    E: { r: 5, f: 5, m: 4, seg: 'Champions', net: 4000 },
  };

  for (const [id, exp] of Object.entries(EXPECTED)) {
    it(`customer ${id} scores exactly R${exp.r} F${exp.f} M${exp.m} → ${exp.seg}, net ${exp.net}`, async () => {
      const f = await features(id);
      expect(f).not.toBeNull();
      expect({ r: f!.rScore, f: f!.fScore, m: f!.mScore, seg: f!.rSegment, net: f!.netRevenueMinor }).toEqual({ r: exp.r, f: exp.f, m: exp.m, seg: exp.seg, net: exp.net });
    });
  }

  it('refund subtracts from monetary — E nets 4000 (not gross 10000) and ranks M4, below D', async () => {
    const e = await features('E');
    const d = await features('D');
    expect(e!.netRevenueMinor).toBe(4000);
    expect(e!.mScore).toBeLessThan(d!.mScore!);
  });

  it('zero paid/fulfilled orders (only PENDING) → excluded from RFM', async () => {
    const z = await features('Z');
    // Either no features row, or one with no RFM score.
    expect(z?.rScore ?? null).toBeNull();
    const inView = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM customer_rfm WHERE customer_id = ${`${orgId}_Z`}`;
    expect(Number(inView[0].n)).toBe(0);
  });

  it('daysSinceLast is computed from the last order (E: 2026-05-01 → 2026-06-01 = 31)', async () => {
    const e = await features('E');
    expect(e!.daysSinceLast).toBe(31);
  });
});
