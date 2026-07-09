import { AiSafeCustomerRepository } from './ai-safe-customer.repository';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * The PII BOUNDARY test. The AI-safe repository is the ONLY door the assistant
 * (and any external-API payload builder) uses to touch customers. This proves it
 * returns pseudonyms + non-identifying fields, reads ONLY the email domain from
 * Customer, and that raw name/email/phone are physically absent from its output.
 */
function build(feats: unknown[], customers: unknown[]) {
  const featFindMany = jest.fn().mockResolvedValue(feats);
  const featFindFirst = jest.fn().mockResolvedValue(feats[0] ?? null);
  const custFindMany = jest.fn().mockResolvedValue(customers);
  const prisma = {
    customerFeatures: { findMany: featFindMany, findFirst: featFindFirst },
    customer: { findMany: custFindMany },
  } as unknown as PrismaService;
  return { repo: new AiSafeCustomerRepository(prisma), featFindMany, custFindMany };
}

const FEAT = { customerId: 'cust_abcdef123456', rSegment: 'Loyal', clvBand: 'High', churnBand: 'Low', vipTier: 'Gold', orderCount: 4, netRevenueMinor: 90000 };
const CUST = { id: 'cust_abcdef123456', emailDomain: 'nerige.co' };

describe('AiSafeCustomerRepository — the PII boundary', () => {
  it('maps features → SafeCustomer with a pseudonym + domain, and NO raw PII', async () => {
    const { repo } = build([FEAT], [CUST]);
    const [row] = await repo.topCustomers('org1', 'net_revenue', 10);
    expect(row.customerId).toBe('cust_abcdef123456');
    expect(row.pseudonym).toBe('Customer #123456'); // last 6 of the id
    expect(row.emailDomain).toBe('nerige.co');
    expect(row.rfmSegment).toBe('Loyal');
    // The type cannot carry contact fields — assert none leaked in anyway.
    expect(row).not.toHaveProperty('email');
    expect(row).not.toHaveProperty('phone');
    expect(row).not.toHaveProperty('firstName');
    expect(row).not.toHaveProperty('lastName');
    expect(JSON.stringify(row)).not.toContain('@nerige.co'); // domain only, never an address
  });

  it('reads ONLY id + emailDomain from Customer — never email/phone/name', async () => {
    const { repo, custFindMany } = build([FEAT], [CUST]);
    await repo.topCustomers('org1', 'net_revenue', 10);
    const select = custFindMany.mock.calls[0][0].select;
    expect(select).toEqual({ id: true, emailDomain: true });
    expect(select.email).toBeUndefined();
    expect(select.phone).toBeUndefined();
    expect(select.firstName).toBeUndefined();
  });

  it('every query is org-scoped', async () => {
    const { repo, featFindMany } = build([FEAT], [CUST]);
    await repo.churnWatchlist('org_9', 20);
    expect(featFindMany.mock.calls[0][0].where.organizationId).toBe('org_9');
  });

  it('forCustomerIds([]) short-circuits without a query', async () => {
    const { repo, custFindMany } = build([], []);
    expect(await repo.forCustomerIds('org1', [])).toEqual([]);
    expect(custFindMany).not.toHaveBeenCalled();
  });
});
