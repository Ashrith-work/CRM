import { PrismaClient } from '@prisma/client';
import { SegmentService } from './segment.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RuleGroup } from '@crm/types';

/**
 * DB-backed segment tests: preview count/sample correctness + < 2s latency, and
 * that a DYNAMIC segment's membership is RECOMPUTED when the underlying data
 * changes. Requires Postgres + the migration applied (as in CI + local dev).
 */
jest.setTimeout(60_000); // DB-backed; can be slow under parallel load.

const prisma = new PrismaClient();
const service = new SegmentService(prisma as unknown as PrismaService);
const SLUG = 'golden-seg';

let orgId: string;
const cid = (n: string) => `${orgId}_${n}`;

const FEATURES: Array<{ id: string; seg: string; net: number; orders: number; r: number }> = [
  { id: 'c1', seg: 'Champions', net: 500000, orders: 5, r: 5 },
  { id: 'c2', seg: 'Champions', net: 300000, orders: 4, r: 5 },
  { id: 'c3', seg: 'At Risk', net: 400000, orders: 3, r: 2 },
  { id: 'c4', seg: 'New', net: 100000, orders: 1, r: 5 },
  { id: 'c5', seg: 'Lost', net: 5000, orders: 1, r: 1 },
];

beforeAll(async () => {
  await prisma.organization.deleteMany({ where: { slug: SLUG } });
  const org = await prisma.organization.create({ data: { name: 'Golden Seg', slug: SLUG } });
  orgId = org.id;
  await prisma.customer.createMany({ data: FEATURES.map((f) => ({ id: cid(f.id), organizationId: orgId, externalId: `ext_${f.id}`, firstName: f.id, lastName: 'Seg', email: `${f.id}@nerige.example` })) });
  await prisma.customerFeatures.createMany({
    data: FEATURES.map((f) => ({ organizationId: orgId, customerId: cid(f.id), rSegment: f.seg, netRevenueMinor: f.net, orderCount: f.orders, rScore: f.r, avgOrderValueMinor: Math.round(f.net / f.orders), currency: 'INR' })),
  });
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { slug: SLUG } });
  await prisma.$disconnect();
});

const champions: RuleGroup = { op: 'AND', rules: [{ field: 'rSegment', op: 'eq', value: 'Champions' }] };

describe('SegmentService.preview', () => {
  it('counts matches, returns a sample sorted by net revenue, in < 2s', async () => {
    const started = Date.now();
    const res = await service.preview(orgId, champions, true);
    const elapsed = Date.now() - started;
    expect(res.count).toBe(2);
    expect(res.sample.map((s) => s.customerId)).toEqual([cid('c1'), cid('c2')]); // net desc
    expect(elapsed).toBeLessThan(2000);
  });

  it('translates a numeric threshold correctly (netRevenueMinor >= 400000 → c1, c3)', async () => {
    const res = await service.preview(orgId, { op: 'AND', rules: [{ field: 'netRevenueMinor', op: 'gte', value: 400000 }] }, true);
    expect(res.count).toBe(2);
    expect(new Set(res.sample.map((s) => s.customerId))).toEqual(new Set([cid('c1'), cid('c3')]));
  });
});

describe('dynamic segment refresh', () => {
  it('snapshots at save, then recomputes membership when data changes', async () => {
    const seg = await service.save(orgId, 'tester', { name: 'Champs', rules: champions, type: 'DYNAMIC', refreshCron: '0 3 * * *' });
    expect(seg.memberCount).toBe(2);

    // A new customer becomes a Champion…
    await prisma.customerFeatures.update({ where: { organizationId_customerId: { organizationId: orgId, customerId: cid('c3') } }, data: { rSegment: 'Champions' } });

    // …the nightly dynamic refresh picks it up.
    await service.refreshDynamic();
    const refreshed = await service.get(orgId, seg.id);
    expect(refreshed.memberCount).toBe(3);
    const members = await service.members(orgId, seg.id, undefined, 50, true);
    expect(new Set(members.data.map((m) => m.customerId))).toEqual(new Set([cid('c1'), cid('c2'), cid('c3')]));
  });
});
