import { MetaSyncService } from './meta-sync.service';
import type { MetaService } from './meta.service';
import { makePii } from '../common/crypto.testkit';

const { pii } = makePii();

describe('MetaSyncService.upsertMetric (idempotent)', () => {
  it('upserts on the UNIQUE(org, entityType, entityId, date) key so a re-pull OVERWRITES', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = { adMetricDaily: { upsert } };
    const svc = new MetaSyncService(prisma as never, {} as MetaService, pii);
    const metric = { entityType: 'campaign' as const, entityId: 'c1', date: new Date('2026-07-01T00:00:00Z'), spendMinor: 123450, impressions: 1000, clicks: 40, conversions: 3 };

    await svc.upsertMetric('org1', metric, 'INR');
    await svc.upsertMetric('org1', metric, 'INR'); // same day twice

    expect(upsert).toHaveBeenCalledTimes(2);
    const call = upsert.mock.calls[0][0];
    expect(call.where).toEqual({ organizationId_entityType_entityId_date: { organizationId: 'org1', entityType: 'campaign', entityId: 'c1', date: metric.date } });
    expect(call.update).toMatchObject({ spendMinor: 123450, impressions: 1000, clicks: 40, conversions: 3, currency: 'INR' });
  });
});

describe('MetaSyncService.linkLeadConversions', () => {
  function build(opts: { paidOrders: number }) {
    const adLeadUpdate = jest.fn().mockResolvedValue({});
    const touchpointUpdate = jest.fn().mockResolvedValue({});
    const prisma = {
      adLead: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'lead1', email: 'priya@shop.in', phone: null, firstTouchTouchpointId: 'tp1' },
        ]),
        update: adLeadUpdate,
      },
      customer: { findFirst: jest.fn().mockResolvedValue({ id: 'cust1' }) },
      order: { count: jest.fn().mockResolvedValue(opts.paidOrders) },
      touchpoint: { update: touchpointUpdate },
    };
    const svc = new MetaSyncService(prisma as never, {} as MetaService, pii);
    return { svc, adLeadUpdate, touchpointUpdate };
  }

  it('converts a lead on first purchase and RE-ATTRIBUTES its Meta touchpoint to the customer', async () => {
    const { svc, adLeadUpdate, touchpointUpdate } = build({ paidOrders: 1 });
    const converted = await svc.linkLeadConversions('org1');
    expect(converted).toBe(1);
    expect(adLeadUpdate).toHaveBeenCalledWith({ where: { id: 'lead1' }, data: { status: 'CONVERTED', convertedCustomerId: 'cust1' } });
    // First-touch touchpoint now points at the customer → first-touch credits Meta.
    expect(touchpointUpdate).toHaveBeenCalledWith({ where: { id: 'tp1' }, data: { customerId: 'cust1' } });
  });

  it('does NOT convert a matched customer who has not purchased yet', async () => {
    const { svc, adLeadUpdate } = build({ paidOrders: 0 });
    const converted = await svc.linkLeadConversions('org1');
    expect(converted).toBe(0);
    expect(adLeadUpdate).not.toHaveBeenCalled();
  });
});
