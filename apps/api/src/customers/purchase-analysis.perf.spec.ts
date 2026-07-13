import { PurchaseAnalysisService } from './purchase-analysis.service';

/** A fake Prisma that records how many times each method is called. */
function fakePrisma(data: any) {
  const calls: Record<string, number> = {};
  const bump = (k: string) => (calls[k] = (calls[k] ?? 0) + 1);
  return {
    calls,
    customer: {
      findMany: async () => { bump('customer.findMany'); return data.customers ?? []; },
      findFirst: async () => { bump('customer.findFirst'); return data.customer ?? null; },
    },
    customerFeatures: {
      findMany: async () => { bump('features.findMany'); return data.featuresList ?? []; },
      findUnique: async () => { bump('features.findUnique'); return data.features ?? null; },
    },
    order: { findMany: async () => { bump('order.findMany'); return data.orders ?? []; } },
    product: { findMany: async () => { bump('product.findMany'); return data.products ?? []; } },
  };
}
const fakePii = {
  emailHashOf: (q: string) => (q.includes('@') ? 'eh' : null),
  phoneHashOf: () => 'ph',
  reveal: (c: any) => ({ email: c.email ?? null, phone: c.phone ?? null, firstName: null, lastName: null }),
  revealName: (c: any) => c.name ?? null,
} as any;
const fakeAudit = { record: async () => {} } as any;
const memRedis = () => {
  const store = new Map<string, unknown>();
  return { store, calls: { get: 0, set: 0 }, async cacheGet(k: string) { (this as any).calls.get++; return store.get(k) ?? null; }, async cacheSet(k: string, v: unknown) { (this as any).calls.set++; store.set(k, v); } } as any;
};

describe('PurchaseAnalysisService — query budget + typeahead guards', () => {
  it('profile loads only 2 orders + items in ONE query + ONE product query (no per-line-item N+1)', async () => {
    const prisma = fakePrisma({
      customer: { id: 'c1', mergedIntoId: null, externalId: 'x', name: 'Sneha' },
      features: { rSegment: 'Champions', orderCount: 8, netRevenueMinor: 100, currency: 'INR', clvMinor: 1, clvBand: 'High', lastOrderAt: new Date() },
      // 2 orders, one with 5 line items — a naive impl would issue 1 query per item.
      orders: [
        { id: 'o1', orderNumber: '1', placedAt: new Date(), totalMinor: 100, refundedMinor: 0, currency: 'INR', discountCode: null, discountMinor: 0, items: Array.from({ length: 5 }, (_, i) => ({ title: `p${i}`, variant: null, quantity: 1, priceMinor: 20, productId: `pr${i}` })) },
        { id: 'o2', orderNumber: '2', placedAt: new Date(), totalMinor: 50, refundedMinor: 0, currency: 'INR', discountCode: null, discountMinor: 0, items: [{ title: 'p', variant: null, quantity: 1, priceMinor: 50, productId: 'pr9' }] },
      ],
      products: [{ id: 'pr0', productType: 'Sarees', tags: ['Silk'] }],
    });
    const svc = new PurchaseAnalysisService(prisma as any, memRedis(), fakePii, fakeAudit);
    const p = await svc.profile('org_1', 'c1', false);

    expect(p.orders).toHaveLength(2);
    expect(prisma.calls['order.findMany']).toBe(1); // ONE query for orders+items, not one-per-item
    expect(prisma.calls['product.findMany']).toBe(1); // ONE batched product lookup
    expect(prisma.calls['features.findUnique']).toBe(1);
    // Total DB calls are bounded (resolve + features + orders + products).
    const total = Object.values(prisma.calls).reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(4);
  });

  it('typeahead is min-length gated: a 1-char query returns [] and never hits the DB', async () => {
    const prisma = fakePrisma({});
    const svc = new PurchaseAnalysisService(prisma as any, memRedis(), fakePii, fakeAudit);
    expect(await svc.suggest('org_1', 'a', false, 8)).toEqual([]);
    expect(prisma.calls['customer.findMany']).toBeUndefined(); // no query fired
  });

  it('typeahead caps results at the limit', async () => {
    const customers = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, externalId: null, name: `Sneha ${i}`, email: null }));
    const featuresList = customers.map((c, i) => ({ customerId: c.id, orderCount: i }));
    const prisma = fakePrisma({ customers, featuresList });
    const svc = new PurchaseAnalysisService(prisma as any, memRedis(), fakePii, fakeAudit);
    const out = await svc.suggest('org_1', 'sneha', false, 8);
    expect(out).toHaveLength(8);
    expect(out[0].orderCount).toBeGreaterThanOrEqual(out[7].orderCount); // ranked by orders desc
  });

  it('a repeated typeahead query is served from cache (no second DB scan)', async () => {
    const customers = [{ id: 'c1', externalId: null, name: 'Sneha', email: null }];
    const prisma = fakePrisma({ customers, featuresList: [{ customerId: 'c1', orderCount: 3 }] });
    const redis = memRedis();
    const svc = new PurchaseAnalysisService(prisma as any, redis, fakePii, fakeAudit);
    await svc.suggest('org_1', 'sneha', false, 8);
    const dbCallsAfterFirst = prisma.calls['customer.findMany'];
    await svc.suggest('org_1', 'sneha', false, 8); // repeat → cache hit
    expect(prisma.calls['customer.findMany']).toBe(dbCallsAfterFirst); // no extra DB scan
    expect(redis.calls.set).toBe(1); // cached once
  });
});

describe('name-search migration', () => {
  it('creates the pg_trgm GIN index on nameSearch', () => {
    const sql = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../prisma/migrations/20260727000000_customer_name_search/migration.sql'), 'utf8');
    expect(sql).toMatch(/CREATE EXTENSION IF NOT EXISTS pg_trgm/i);
    expect(sql).toMatch(/USING gin \("nameSearch" gin_trgm_ops\)/i);
  });
});
