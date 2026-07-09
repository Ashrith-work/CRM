import { AttributionService } from './attribution.service';

/**
 * Order-level attribution coverage: orders with a known first-touch source ÷ all
 * orders. "unknown" (and null) fold into one honest bucket — never a fabricated
 * source.
 */
describe('AttributionService.orderCoverage', () => {
  it('computes coverage %, folding null + "unknown" into one bucket', async () => {
    const prisma = {
      order: {
        groupBy: jest.fn().mockResolvedValue([
          { firstTouchSource: 'meta', _count: { _all: 3 } },
          { firstTouchSource: 'google', _count: { _all: 1 } },
          { firstTouchSource: 'unknown', _count: { _all: 1 } },
          { firstTouchSource: null, _count: { _all: 1 } }, // folds into "unknown"
        ]),
      },
    };
    const svc = new AttributionService(prisma as never);
    const cov = await svc.orderCoverage('org1');

    expect(cov.totalOrders).toBe(6);
    expect(cov.ordersWithKnownSource).toBe(4); // meta(3) + google(1)
    expect(cov.coveragePct).toBe(66.7);
    const unknown = cov.bySource.find((s) => s.source === 'unknown')!;
    expect(unknown.orders).toBe(2); // 1 explicit + 1 null
    expect(cov.bySource[0].source).toBe('meta'); // sorted by order count desc
  });

  it('is 0% with no orders (never divides by zero)', async () => {
    const prisma = { order: { groupBy: jest.fn().mockResolvedValue([]) } };
    const svc = new AttributionService(prisma as never);
    const cov = await svc.orderCoverage('org1');
    expect(cov).toEqual({ totalOrders: 0, ordersWithKnownSource: 0, coveragePct: 0, bySource: [] });
  });
});
