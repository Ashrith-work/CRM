import { IncentiveService } from './incentive.service';

const CONFIG_DEFAULTS: Record<string, unknown> = {
  INCENTIVE_TRIGGER_METRIC: 'orders',
  INCENTIVE_TRIGGER_THRESHOLD: 5,
  INCENTIVE_MAX_VALUE_MINOR: 50_000,
  INCENTIVE_MIN_NEXT_ORDER_MINOR: 200_000,
  INCENTIVE_VALIDITY_DAYS: 30,
  INCENTIVE_MARGIN_GUARD: false,
  INCENTIVE_MARGIN_FLOOR_PCT: 20,
};

function build(overrides: {
  config?: Record<string, unknown>;
  prisma?: Record<string, unknown>;
  gateAllowed?: boolean;
} = {}) {
  const cfg = { ...CONFIG_DEFAULTS, ...overrides.config };
  const incentiveCreate = jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'inc1', discountPercent: null, redeemedOrderId: null, createdAt: new Date(), updatedAt: new Date(), ...data }));
  const incentiveUpdate = jest.fn().mockResolvedValue({});
  const incentiveUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    incentive: { findFirst: jest.fn().mockResolvedValue(null), create: incentiveCreate, update: incentiveUpdate, updateMany: incentiveUpdateMany, findMany: jest.fn().mockResolvedValue([]) },
    order: { count: jest.fn().mockResolvedValue(0) },
    orderItem: { aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 0 } }), findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]) },
    product: { findMany: jest.fn().mockResolvedValue([]) },
    customer: { findFirst: jest.fn().mockResolvedValue({ email: 'buyer@shop.in' }) },
    ...overrides.prisma,
  };
  const discounts = { issue: jest.fn().mockResolvedValue({ code: 'LOYAL-ABCD', external: false }), generateCode: () => 'LOYAL-ABCD' };
  const gate = { canSend: jest.fn().mockResolvedValue({ allowed: overrides.gateAllowed ?? true }) };
  const email = { send: jest.fn().mockResolvedValue({ providerMessageId: 'm1' }) };
  const loyalty = { burn: jest.fn().mockResolvedValue(undefined) };
  const config = { get: (k: string) => cfg[k] };
  const svc = new IncentiveService(prisma as never, config as never, discounts as never, gate as never, email as never, loyalty as never);
  return { svc, prisma, discounts, gate, email, loyalty, incentiveCreate, incentiveUpdate, incentiveUpdateMany };
}

describe('IncentiveService.measure (precise "X products")', () => {
  it('orders = count of paid/fulfilled orders', async () => {
    const { svc, prisma } = build();
    (prisma.order.count as jest.Mock).mockResolvedValue(7);
    expect(await svc.measure('org1', 'c1', { metric: 'orders', threshold: 5 })).toBe(7);
  });
  it('units = sum of item quantities', async () => {
    const { svc, prisma } = build();
    (prisma.orderItem.aggregate as jest.Mock).mockResolvedValue({ _sum: { quantity: 12 } });
    expect(await svc.measure('org1', 'c1', { metric: 'units', threshold: 5 })).toBe(12);
  });
  it('distinct_skus = number of distinct products', async () => {
    const { svc, prisma } = build();
    (prisma.orderItem.findMany as jest.Mock).mockResolvedValue([{ productId: 'p1' }, { productId: 'p2' }]);
    expect(await svc.measure('org1', 'c1', { metric: 'distinct_skus', threshold: 2 })).toBe(2);
  });
});

describe('IncentiveService.evaluateForOrder → issue', () => {
  it('issues a VALUE-CAPPED, min-order incentive when the threshold is crossed', async () => {
    const { svc, prisma, incentiveCreate } = build();
    (prisma.order.count as jest.Mock).mockResolvedValue(5); // == threshold
    const result = await svc.evaluateForOrder('org1', { externalId: 'ord1', customerId: 'c1', status: 'PAID', discountCode: null });
    expect(result).not.toBeNull();
    const data = incentiveCreate.mock.calls[0][0].data;
    // The reward equals the cap, so the discount VALUE can never exceed it.
    expect(data.discountValueMinor).toBe(50_000);
    expect(data.maxValueMinor).toBe(50_000);
    expect(data.minNextOrderMinor).toBe(200_000);
    expect(data.status).toBe('ACTIVE');
    expect(data.sourceOrderId).toBe('ord1');
    expect(data.discountCode).toBe('LOYAL-ABCD');
  });

  it('does NOT issue below the threshold', async () => {
    const { svc, prisma, incentiveCreate } = build();
    (prisma.order.count as jest.Mock).mockResolvedValue(4);
    expect(await svc.evaluateForOrder('org1', { externalId: 'ord1', customerId: 'c1', status: 'PAID', discountCode: null })).toBeNull();
    expect(incentiveCreate).not.toHaveBeenCalled();
  });

  it('does NOT stack a second active incentive', async () => {
    const { svc, prisma, incentiveCreate } = build();
    (prisma.incentive.findFirst as jest.Mock).mockResolvedValue({ id: 'existing' });
    (prisma.order.count as jest.Mock).mockResolvedValue(9);
    expect(await svc.evaluateForOrder('org1', { externalId: 'ord1', customerId: 'c1', status: 'PAID', discountCode: null })).toBeNull();
    expect(incentiveCreate).not.toHaveBeenCalled();
  });
});

describe('IncentiveService margin guard honesty', () => {
  it('excludes provably low-margin SKUs when cost data exists', async () => {
    const { svc } = build({
      config: { INCENTIVE_MARGIN_GUARD: true },
      prisma: {
        product: { findMany: jest.fn().mockResolvedValue([{ id: 'p1', externalId: 'ext1', costMinor: 9_000 }, { id: 'p2', externalId: 'ext2', costMinor: 2_000 }]) },
        orderItem: { groupBy: jest.fn().mockResolvedValue([{ productId: 'p1', _avg: { priceMinor: 10_000 } }, { productId: 'p2', _avg: { priceMinor: 10_000 } }]) },
      },
    });
    const m = await svc.marginExclusions('org1');
    expect(m.effective).toBe(true);
    expect(m.excluded).toEqual(['ext1']); // p1 margin 10% < 20 floor; p2 80% ok
  });

  it('does NOT pretend margin-safety exists when there is no cost data', async () => {
    const { svc } = build({ config: { INCENTIVE_MARGIN_GUARD: true }, prisma: { product: { findMany: jest.fn().mockResolvedValue([]) } } });
    const m = await svc.marginExclusions('org1');
    expect(m.requested).toBe(true);
    expect(m.effective).toBe(false); // honest: guard requested but couldn't run
    expect(m.excluded).toEqual([]);
  });
});

describe('IncentiveService redemption + refund', () => {
  it('marks an incentive REDEEMED once when a matching code lands (no double-redemption)', async () => {
    const { svc, prisma, incentiveUpdate } = build();
    (prisma.incentive.findFirst as jest.Mock).mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      where.discountCode ? Promise.resolve({ id: 'inc1', discountCode: 'LOYAL-ABCD', pointsCost: 0 }) : Promise.resolve(null),
    );
    await svc.onOrder('org1', { externalId: 'ord2', customerId: 'c1', status: 'PAID', discountCode: 'LOYAL-ABCD' });
    expect(incentiveUpdate).toHaveBeenCalledWith({ where: { id: 'inc1' }, data: { status: 'REDEEMED', redeemedOrderId: 'ord2' } });
  });

  it('does not redeem an unknown/already-redeemed code', async () => {
    const { svc, prisma, incentiveUpdate } = build();
    (prisma.incentive.findFirst as jest.Mock).mockResolvedValue(null); // code not ACTIVE
    await svc.onOrder('org1', { externalId: 'ord2', customerId: 'c1', status: 'PAID', discountCode: 'LOYAL-ABCD' });
    expect(incentiveUpdate).not.toHaveBeenCalled();
  });

  it('reverses (expires) an active incentive when its qualifying order is refunded', async () => {
    const { svc, incentiveUpdateMany } = build();
    await svc.onRefund('org1', 'ord1');
    expect(incentiveUpdateMany).toHaveBeenCalledWith({ where: { organizationId: 'org1', sourceOrderId: 'ord1', status: 'ACTIVE' }, data: { status: 'EXPIRED' } });
  });
});

describe('IncentiveService.notify — ConsentGate', () => {
  it('sends the reward email WITH marketing consent', async () => {
    const { svc, email } = build({ gateAllowed: true });
    await svc.notify('org1', 'c1', { discountCode: 'LOYAL-ABCD', discountValueMinor: 50_000, minNextOrderMinor: 200_000, validUntil: new Date('2026-08-01') } as never);
    expect(email.send).toHaveBeenCalled();
  });

  it('does NOT send without marketing consent (discount still attaches silently)', async () => {
    const { svc, email, gate } = build({ gateAllowed: false });
    (gate.canSend as jest.Mock).mockResolvedValue({ allowed: false, reason: 'consent not captured' });
    await svc.notify('org1', 'c1', { discountCode: 'LOYAL-ABCD', discountValueMinor: 50_000, minNextOrderMinor: 200_000, validUntil: new Date('2026-08-01') } as never);
    expect(email.send).not.toHaveBeenCalled();
  });
});
