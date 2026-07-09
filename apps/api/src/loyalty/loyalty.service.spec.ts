import { LoyaltyService, computePoints } from './loyalty.service';

const DIVISOR = 10_000; // 1 point per ₹100

describe('computePoints (pure)', () => {
  it('earns floor(net ÷ divisor) on paid/fulfilled orders', () => {
    expect(computePoints('PAID', 250_000, 0, DIVISOR)).toBe(25);
    expect(computePoints('FULFILLED', 199_999, 0, DIVISOR)).toBe(19); // floor
  });
  it('nets out refunds', () => {
    expect(computePoints('PAID', 250_000, 100_000, DIVISOR)).toBe(15); // net 150k → 15
    expect(computePoints('PAID', 250_000, 250_000, DIVISOR)).toBe(0); // fully refunded
  });
  it('earns nothing on non-paid orders', () => {
    expect(computePoints('PENDING', 250_000, 0, DIVISOR)).toBe(0);
    expect(computePoints('CANCELLED', 250_000, 0, DIVISOR)).toBe(0);
  });
});

function build(opts: { orderLedgerSum?: number; balance?: number } = {}) {
  const create = jest.fn().mockResolvedValue({});
  const prisma = {
    loyaltyTransaction: {
      create,
      aggregate: jest.fn().mockResolvedValue({ _sum: { delta: opts.orderLedgerSum ?? opts.balance ?? 0 } }),
    },
  };
  const config = { get: () => DIVISOR };
  const svc = new LoyaltyService(prisma as never, config as never);
  return { svc, create };
}

describe('LoyaltyService.reconcileOrder (append-only earn/clawback)', () => {
  it('writes an EARN for the earned points on a fresh paid order', async () => {
    const { svc, create } = build({ orderLedgerSum: 0 });
    const delta = await svc.reconcileOrder('org1', { externalId: 'ord1', customerId: 'c1', status: 'PAID', totalMinor: 250_000, refundedMinor: 0 });
    expect(delta).toBe(25);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ delta: 25, reason: 'EARN', refOrderId: 'ord1' }) }));
  });

  it('writes a negative CLAWBACK when a refund lowers the net (already earned 25, now nets 15)', async () => {
    const { svc, create } = build({ orderLedgerSum: 25 }); // already earned 25
    const delta = await svc.reconcileOrder('org1', { externalId: 'ord1', customerId: 'c1', status: 'PAID', totalMinor: 250_000, refundedMinor: 100_000 });
    expect(delta).toBe(-10); // target 15 − current 25
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ delta: -10, reason: 'CLAWBACK' }) }));
  });

  it('is idempotent — no write when the ledger already matches the target', async () => {
    const { svc, create } = build({ orderLedgerSum: 25 });
    const delta = await svc.reconcileOrder('org1', { externalId: 'ord1', customerId: 'c1', status: 'PAID', totalMinor: 250_000, refundedMinor: 0 });
    expect(delta).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('skips orders with no customer', async () => {
    const { svc, create } = build();
    expect(await svc.reconcileOrder('org1', { externalId: 'ord1', customerId: null, status: 'PAID', totalMinor: 250_000, refundedMinor: 0 })).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('LoyaltyService.burn', () => {
  it('burns when the balance covers it', async () => {
    const { svc, create } = build({ balance: 100 });
    await svc.burn('org1', 'c1', 40, null, 'redeem');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ delta: -40, reason: 'BURN' }) }));
  });

  it('refuses to drive the balance negative', async () => {
    const { svc } = build({ balance: 30 });
    await expect(svc.burn('org1', 'c1', 40, null, 'redeem')).rejects.toThrow(/insufficient/);
  });
});
