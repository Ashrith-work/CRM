import { LeadsService } from './leads.service';

/**
 * Lead → Customer conversion (the gap this milestone fills). The existing
 * lead→contact flow is untouched; these tests cover the added commerce-Customer
 * resolution: find-or-create by email/phone (deduped), convertedCustomerId,
 * first-touch re-attribution, and the customer-360 timeline Interaction.
 */
function makeLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead1',
    organizationId: 'org1',
    firstName: 'Priya',
    lastName: 'Sharma',
    email: 'priya@shop.in',
    phone: '+919000000001',
    source: 'meta',
    status: 'NEW',
    ownerId: 'u1',
    convertedContactId: null,
    convertedCustomerId: null,
    firstTouchTouchpointId: 'tp1',
    customFields: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

function build(opts: { lead?: Record<string, unknown>; existingCustomer?: boolean } = {}) {
  const lead = makeLead(opts.lead);
  const tx = {
    contact: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'contact1', companyId: null }),
      update: jest.fn(),
    },
    lead: { update: jest.fn().mockResolvedValue({}) },
  };
  const leadUpdate = jest.fn().mockResolvedValue({});
  const touchpointUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const interactionUpsert = jest.fn().mockResolvedValue({});
  const prisma = {
    lead: { findFirst: jest.fn().mockResolvedValue(lead), update: leadUpdate },
    customer: {
      findFirst: jest.fn().mockResolvedValue(opts.existingCustomer ? { id: 'cust1' } : null),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'cust1', organizationId: 'org1', externalId: null, email: 'priya@shop.in', phone: '+919000000001', firstName: 'Priya', lastName: 'Sharma', mergedIntoId: null, createdAt: new Date(), updatedAt: new Date() }),
    },
    touchpoint: { updateMany: touchpointUpdateMany },
    interaction: { upsert: interactionUpsert },
    $transaction: jest.fn().mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const identity = { resolveCustomer: jest.fn().mockResolvedValue('cust1') };
  const contacts = { get: jest.fn().mockResolvedValue({ id: 'contact1' }) };
  const companies = { get: jest.fn(), create: jest.fn() };
  const tags = { tagsForEntities: jest.fn().mockResolvedValue(new Map()) };
  const activity = { emit: jest.fn().mockResolvedValue(undefined) };
  const svc = new LeadsService(prisma as never, activity as never, tags as never, {} as never, contacts as never, companies as never, identity as never);
  return { svc, prisma, identity, touchpointUpdateMany, interactionUpsert, leadUpdate };
}

describe('LeadsService.convert → commerce Customer', () => {
  it('find-or-creates a Customer by email/phone, sets convertedCustomerId, re-attributes, and adds a timeline Interaction', async () => {
    const { svc, identity, touchpointUpdateMany, interactionUpsert, leadUpdate } = build();

    const result = await svc.convert('org1', 'lead1', {}, 'actor1');

    // Identity resolution with the lead's identifiers (M1 dedup).
    expect(identity.resolveCustomer).toHaveBeenCalledWith(
      'org1',
      { email: 'priya@shop.in', phone: '+919000000001', firstName: 'Priya', lastName: 'Sharma' },
      'actor1',
    );
    // convertedCustomerId persisted.
    expect(leadUpdate).toHaveBeenCalledWith({ where: { id: 'lead1' }, data: { convertedCustomerId: 'cust1' } });
    // First-touch touchpoint re-attributed to the customer.
    expect(touchpointUpdateMany).toHaveBeenCalledWith({ where: { id: 'tp1', organizationId: 'org1' }, data: { customerId: 'cust1' } });
    // Lead lands on the customer 360 timeline (LEAD interaction).
    expect(interactionUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId_type_refId: { organizationId: 'org1', type: 'LEAD', refId: 'lead1' } },
      create: expect.objectContaining({ customerId: 'cust1', type: 'LEAD', refId: 'lead1' }),
    }));
    expect(result.customer?.id).toBe('cust1');
    expect(result.customerCreated).toBe(true); // no prior customer → created
  });

  it('is deduped: an existing customer is reused (customerCreated=false)', async () => {
    const { svc, identity } = build({ existingCustomer: true });
    const result = await svc.convert('org1', 'lead1', {}, 'actor1');
    expect(identity.resolveCustomer).toHaveBeenCalledTimes(1);
    expect(result.customerCreated).toBe(false);
  });

  it('skips customer creation when the lead has neither email nor phone (no anonymous rows)', async () => {
    const { svc, identity, interactionUpsert } = build({ lead: { email: null, phone: null } });
    const result = await svc.convert('org1', 'lead1', {}, 'actor1');
    expect(identity.resolveCustomer).not.toHaveBeenCalled();
    expect(interactionUpsert).not.toHaveBeenCalled();
    expect(result.customer).toBeNull();
    expect(result.customerCreated).toBe(false);
  });
});
