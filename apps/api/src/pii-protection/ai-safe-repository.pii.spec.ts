import { AiSafeCustomerRepository } from '../customers/ai-safe-customer.repository';
import type { PrismaService } from '../prisma/prisma.service';
import { assertNoRawPII } from './assert-no-raw-pii';

/**
 * TEST 2 — the AI-safe repository (the PII boundary) return type EXCLUDES raw PII.
 *
 * The assistant's tools and any external payload builder touch customers ONLY
 * through this repo. We assert the returned object carries a pseudonym + non-
 * identifying fields, that raw name/email/phone are ABSENT (not masked — absent),
 * and that assertNoRawPII passes on the result. The known fixture PII is never
 * even queried (the repo reads only id + emailDomain from Customer).
 */
const FIXTURES = { emails: ['jane@nerige.co'], phones: ['+919876543210'], names: ['Jane Doe'] };

// A features row + a Customer row that (if the repo leaked) COULD expose PII —
// but the repo only ever selects { id, emailDomain }, so the raw fields below are
// intentionally present to prove they don't escape.
const FEAT = { customerId: 'cust_abcdef123456', rSegment: 'Loyal', clvBand: 'High', churnBand: 'Low', vipTier: 'Gold', orderCount: 4, netRevenueMinor: 90000 };
const CUST = { id: 'cust_abcdef123456', emailDomain: 'nerige.co' };

function build() {
  const prisma = {
    customerFeatures: {
      findMany: jest.fn().mockResolvedValue([FEAT]),
      findFirst: jest.fn().mockResolvedValue(FEAT),
    },
    customer: { findMany: jest.fn().mockResolvedValue([CUST]) },
  } as unknown as PrismaService;
  return new AiSafeCustomerRepository(prisma);
}

describe('TEST 2 — AI-safe repository excludes raw PII', () => {
  it('topCustomers() returns a pseudonym + domain and NO raw PII', async () => {
    const repo = build();
    const [row] = await repo.topCustomers('org1', 'net_revenue', 10);

    assertNoRawPII(row, FIXTURES, 'aiSafe.topCustomers row');

    // Non-identifying fields are present (so it still WORKS, just without PII).
    expect(row.pseudonym).toBe('Customer #123456');
    expect(row.emailDomain).toBe('nerige.co');
    expect(row.rfmSegment).toBe('Loyal');
    expect(row.vipTier).toBe('Gold');

    // Raw contact fields are physically ABSENT, not masked.
    expect(row).not.toHaveProperty('email');
    expect(row).not.toHaveProperty('phone');
    expect(row).not.toHaveProperty('firstName');
    expect(row).not.toHaveProperty('lastName');
    expect(row).not.toHaveProperty('name');
  });

  it('customerSummary() is PII-free too', async () => {
    const repo = build();
    const row = await repo.customerSummary('org1', 'cust_abcdef123456');
    expect(row).not.toBeNull();
    assertNoRawPII(row, FIXTURES, 'aiSafe.customerSummary');
    expect(row).not.toHaveProperty('email');
  });

  it('reads ONLY { id, emailDomain } from Customer — never email/phone/name', async () => {
    const prisma = {
      customerFeatures: { findMany: jest.fn().mockResolvedValue([FEAT]), findFirst: jest.fn() },
      customer: { findMany: jest.fn().mockResolvedValue([CUST]) },
    } as unknown as PrismaService;
    const repo = new AiSafeCustomerRepository(prisma);
    await repo.topCustomers('org1', 'net_revenue', 10);

    const select = (prisma.customer.findMany as jest.Mock).mock.calls[0][0].select;
    expect(select).toEqual({ id: true, emailDomain: true });
  });
});
