import { PrismaClient } from '@prisma/client';
import { CampaignService } from './campaign.service';
import type { PrismaService } from '../prisma/prisma.service';

jest.setTimeout(60_000); // DB-backed.

/**
 * Recovery-rate computation vs a HAND-COMPUTED fixture.
 *   5 enrolled carts; 2 converted within the 7-day window, 1 converted OUTSIDE
 *   it (not credited), 2 not converted. Orders o1=₹2000, o2=₹3000 (net) →
 *   recoveryRate = 2/5 = 0.4, recoveredRevenue = 500000 paise.
 */
const prisma = new PrismaClient();
const service = new CampaignService(prisma as unknown as PrismaService);
const SLUG = 'recovery-stats';
let orgId: string;
let campaignId: string;

const T = new Date('2026-06-01T00:00:00Z');
const plus = (h: number) => new Date(T.getTime() + h * 60 * 60_000);

beforeAll(async () => {
  await prisma.organization.deleteMany({ where: { slug: SLUG } });
  const org = await prisma.organization.create({ data: { name: 'Recovery Stats', slug: SLUG } });
  orgId = org.id;
  const c = await prisma.campaign.create({ data: { organizationId: orgId, name: 'R', type: 'ABANDONED_CART', attributionWindowMinutes: 10080 } });
  campaignId = c.id;

  // Two recovered orders (net = total − refunded).
  await prisma.order.createMany({
    data: [
      { id: `${orgId}_o1`, organizationId: orgId, externalId: 'o1', status: 'PAID', financialStatus: 'PAID', totalMinor: 200000, refundedMinor: 0, currency: 'INR', placedAt: plus(2) },
      { id: `${orgId}_o2`, organizationId: orgId, externalId: 'o2', status: 'PAID', financialStatus: 'PAID', totalMinor: 350000, refundedMinor: 50000, currency: 'INR', placedAt: plus(3) },
      { id: `${orgId}_o3`, organizationId: orgId, externalId: 'o3', status: 'PAID', financialStatus: 'PAID', totalMinor: 999999, refundedMinor: 0, currency: 'INR', placedAt: plus(200) },
    ],
  });

  const base = { organizationId: orgId, campaignId, checkoutStartedAt: T, enrolledAt: T };
  await prisma.campaignEnrollment.createMany({
    data: [
      { ...base, cartId: 'c1', customerId: 'x1', email: 'e1@x.co', status: 'CONVERTED', convertedOrderId: `${orgId}_o1`, convertedAt: plus(2) }, // in window
      { ...base, cartId: 'c2', customerId: 'x2', email: 'e2@x.co', status: 'CONVERTED', convertedOrderId: `${orgId}_o2`, convertedAt: plus(3) }, // in window
      { ...base, cartId: 'c3', customerId: 'x3', email: 'e3@x.co', status: 'CONVERTED', convertedOrderId: `${orgId}_o3`, convertedAt: plus(200) }, // OUTSIDE window (8+ days)
      { ...base, cartId: 'c4', customerId: 'x4', email: 'e4@x.co', status: 'ACTIVE' },
      { ...base, cartId: 'c5', customerId: 'x5', email: 'e5@x.co', status: 'HALTED', haltReason: 'suppressed:unsubscribe' },
    ],
  });
  const enrs = await prisma.campaignEnrollment.findMany({ where: { organizationId: orgId } });
  const step = await prisma.campaignStep.create({ data: { campaignId, stepOrder: 1, delayMinutes: 60, templateId: (await prisma.messageTemplate.create({ data: { organizationId: orgId, key: 't', version: 1, name: 't', subject: 's', bodyHtml: 'h', bodyText: 't' } })).id } });
  // Sends breakdown fixture: SENT, OPENED, BLOCKED, BOUNCED, DELAYED.
  const statuses = ['SENT', 'OPENED', 'BLOCKED', 'BOUNCED', 'DELAYED'] as const;
  await prisma.campaignSend.createMany({ data: enrs.map((e, i) => ({ organizationId: orgId, enrollmentId: e.id, campaignStepId: step.id, templateVersion: 1, status: statuses[i] })) });
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { slug: SLUG } });
  await prisma.$disconnect();
});

describe('recovery stats (hand-computed fixture)', () => {
  it('recoveryRate = 2/5, recoveredRevenue = 500000 (only in-window conversions)', async () => {
    const stats = await service.recoveryStats(orgId);
    expect(stats.abandonedCarts).toBe(5);
    expect(stats.recoveredCarts).toBe(2);
    expect(stats.recoveryRate).toBeCloseTo(0.4, 5);
    expect(stats.recoveredRevenueMinor).toBe(500000); // 200000 + (350000−50000)
  });

  it('sends breakdown reflects real CampaignSend rows', async () => {
    const stats = await service.recoveryStats(orgId);
    expect(stats.sends.total).toBe(5);
    expect(stats.sends.blocked).toBe(1);
    expect(stats.sends.bounced).toBe(1);
    expect(stats.sends.delayed).toBe(1);
    expect(stats.sends.opened).toBe(1); // OPENED (CLICKED would also count)
    expect(stats.sends.sent).toBe(3); // SENT + OPENED + BOUNCED (dispatched)
  });
});
