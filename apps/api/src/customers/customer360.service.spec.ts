import { Customer360Service, serializeRecentOrder } from './customer360.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';

function svc(order: { findMany?: jest.Mock } = {}, interaction: { findMany?: jest.Mock } = {}) {
  const prisma = {
    customer: { findFirst: jest.fn().mockResolvedValue({ id: 'c1', organizationId: 'org1', mergedIntoId: null, deletedAt: null }) },
    order: { findMany: order.findMany ?? jest.fn().mockResolvedValue([]) },
    interaction: { findMany: interaction.findMany ?? jest.fn().mockResolvedValue([]) },
  } as unknown as PrismaService;
  const redis = { cacheGet: jest.fn().mockResolvedValue(null), cacheSet: jest.fn() } as unknown as RedisService;
  return { service: new Customer360Service(prisma, redis), prisma };
}

describe('serializeRecentOrder', () => {
  it('computes net (total − refunded), "Mon YYYY" label, and item summary', () => {
    const ro = serializeRecentOrder({
      id: 'o1',
      orderNumber: '1042',
      placedAt: new Date('2026-06-15T00:00:00Z'),
      status: 'FULFILLED',
      financialStatus: 'PARTIALLY_REFUNDED',
      totalMinor: 245000,
      refundedMinor: 45000,
      currency: 'INR',
      discountCode: 'DIWALI10',
      discountMinor: 10000,
      externalId: '555',
      items: [{ title: 'Cotton Tee', variant: 'M / Black', quantity: 2 }],
    } as never);
    expect(ro.netMinor).toBe(200000);
    expect(ro.monthLabel).toBe('Jun 2026');
    expect(ro.itemsSummary).toBe('Cotton Tee (M / Black) ×2');
    expect(ro.discountCode).toBe('DIWALI10');
  });
});

describe('Customer360Service.recentOrders (range control)', () => {
  it('default = last 3 (take 3, no date filter)', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const { service } = svc({ findMany });
    await service.recentOrders('org1', 'c1', { limit: 3 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 3, where: expect.not.objectContaining({ placedAt: expect.anything() }) }));
  });

  it('limit 0 = all (take 500)', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const { service } = svc({ findMany });
    await service.recentOrders('org1', 'c1', { limit: 0 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 500 }));
  });

  it('year+month filters to that month', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const { service } = svc({ findMany });
    await service.recentOrders('org1', 'c1', { limit: 3, year: 2026, month: 6 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ placedAt: { gte: new Date('2026-06-01T00:00:00Z'), lt: new Date('2026-07-01T00:00:00Z') } }),
        take: 500,
      }),
    );
  });

  it('custom from–to filters the range', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const { service } = svc({ findMany });
    await service.recentOrders('org1', 'c1', { limit: 3, from: '2026-01-01T00:00:00Z', to: '2026-03-31T00:00:00Z' });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ placedAt: { gte: new Date('2026-01-01T00:00:00Z'), lte: new Date('2026-03-31T00:00:00Z') } }) }),
    );
  });
});

describe('Customer360Service.timeline (one indexed query + type filter)', () => {
  it('filters by uppercased type, orders newest-first, lowercases output', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: 'i1', type: 'ORDER', refId: '555', summary: 'Order #1042', occurredAt: new Date('2026-06-01T00:00:00Z') },
    ]);
    const { service } = svc({}, { findMany });
    const res = await service.timeline('org1', 'c1', { limit: 25, type: 'order' });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org1', customerId: 'c1', type: 'ORDER' }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }] }),
    );
    expect(res.data[0]).toEqual({ id: 'i1', type: 'order', refId: '555', summary: 'Order #1042', occurredAt: '2026-06-01T00:00:00.000Z' });
    expect(res.nextCursor).toBeNull();
  });
});
