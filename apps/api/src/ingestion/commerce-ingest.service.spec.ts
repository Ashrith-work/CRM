import { CommerceIngestService } from './commerce-ingest.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { IdentityService } from '../customers/identity.service';
import type { ShopifyService, ShopifyConn } from './shopify.service';
import type { MarketingConsentWriter } from './marketing-consent.writer';

const consent = {} as MarketingConsentWriter;

const conn: ShopifyConn = { shopDomain: 'nerige.myshopify.com', accessToken: 't', apiVersion: '2024-10' };

describe('CommerceIngestService.applyRefund', () => {
  it('adds the refund, recomputes financialStatus, and keeps the order (not zeroed/deleted)', async () => {
    const update = jest.fn().mockResolvedValue({});
    const del = jest.fn();
    const prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue({ id: 'o1', totalMinor: 10000, refundedMinor: 0, financialStatus: 'PAID' }),
        update,
        delete: del,
      },
    } as unknown as PrismaService;
    const service = new CommerceIngestService(prisma, {} as IdentityService, {} as ShopifyService, consent);

    await service.applyRefund('org1', '555', { transactions: [{ kind: 'refund', status: 'success', amount: '40.00' }] });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { refundedMinor: 4000, financialStatus: 'PARTIALLY_REFUNDED' },
    });
    expect(del).not.toHaveBeenCalled();
  });

  it('ignores a refund for an unknown order', async () => {
    const update = jest.fn();
    const prisma = { order: { findUnique: jest.fn().mockResolvedValue(null), update } } as unknown as PrismaService;
    const service = new CommerceIngestService(prisma, {} as IdentityService, {} as ShopifyService, consent);
    await service.applyRefund('org1', 'nope', { transactions: [] });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('CommerceIngestService.reconcile (self-heal)', () => {
  it('re-imports orders since the window and reports counts (fills a missing order)', async () => {
    const rawMissing = { id: 999, order_number: 5, created_at: '2026-06-01T00:00:00Z', total_price: '100.00', financial_status: 'paid', currency: 'INR' };
    const prisma = { order: { count: jest.fn().mockResolvedValue(3) } } as unknown as PrismaService;
    const shopify = {
      orderCount: jest.fn().mockResolvedValue(3),
      paginate: jest.fn().mockImplementation(async (_c, _r, _q, onBatch: (i: unknown[]) => Promise<void>) => {
        await onBatch([rawMissing]);
        return 1;
      }),
    } as unknown as ShopifyService;
    const service = new CommerceIngestService(prisma, {} as IdentityService, shopify, consent);
    // Isolate the gap-fill loop from the heavy upsert path.
    const upsertOrder = jest.spyOn(service, 'upsertOrder').mockResolvedValue('o999');

    const result = await service.reconcile('org1', conn, '2026-05-01T00:00:00Z');

    expect(upsertOrder).toHaveBeenCalledTimes(1);
    expect(upsertOrder).toHaveBeenCalledWith('org1', expect.objectContaining({ externalId: '999', totalMinor: 10000 }));
    expect(result).toEqual({ shopifyCount: 3, fetched: 1, crmCount: 3 });
  });
});
