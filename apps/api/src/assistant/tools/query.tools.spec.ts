import { TOOLS_BY_NAME } from './query.tools';
import type { ToolContext } from './tool.types';
import type { SafeCustomer } from '@crm/types';

/**
 * The safe tool layer is the security foundation. After the PII milestone it is
 * PSEUDONYMIZED BY CONSTRUCTION: customer-shaped tools go through the AI-safe
 * repository, which can only return SafeCustomer (customerId + pseudonym +
 * non-identifying fields). These tests prove no raw name/email/phone can escape
 * onto the AI path and that queries never leave the org.
 */
function safe(overrides: Partial<SafeCustomer> = {}): SafeCustomer {
  return {
    customerId: 'c1',
    pseudonym: 'Customer #abc123',
    emailDomain: 'nerige.co',
    rfmSegment: 'Loyal',
    clvBand: 'Mid',
    churnBand: 'Low',
    vipTier: null,
    orderCount: 3,
    netRevenueMinor: 5000,
    ...overrides,
  };
}

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    organizationId: 'org_1',
    actorUserId: 'user_1',
    permissions: [],
    unmaskedPii: false,
    prisma: {} as never,
    analytics: {} as never,
    segments: {} as never,
    aiSafe: {} as never,
    ...overrides,
  };
}

// No raw PII may appear anywhere in a tool's serialized output.
function assertNoRawPii(value: unknown): void {
  const json = JSON.stringify(value);
  expect(json).not.toContain('@'); // no email
  expect(json).not.toMatch(/Jane|Doe|Amit|Sharma|Priya/); // no known names
  expect(json).not.toMatch(/"(email|phone|firstName|lastName|name)":/); // no PII keys
}

describe('safe read-only tool layer (pseudonymized)', () => {
  it('top_customers returns pseudonyms + non-identifying fields only — never contact', async () => {
    const topCustomers = jest.fn().mockResolvedValue([safe()]);
    const ctx = makeCtx({ aiSafe: { topCustomers } as never });
    const res = await TOOLS_BY_NAME.get('top_customers')!.execute(ctx, { by: 'net_revenue', n: 10 });
    const rows = (res.data as { rows: SafeCustomer[] }).rows;
    expect(rows[0].pseudonym).toBe('Customer #abc123');
    expect(rows[0]).not.toHaveProperty('email');
    expect(rows[0]).not.toHaveProperty('firstName');
    assertNoRawPii(res.data);
    // The tool went through the AI-safe boundary, not raw prisma.
    expect(topCustomers).toHaveBeenCalledWith('org_1', 'net_revenue', 10);
  });

  it('top_customers output is identical regardless of the asker role (no unmasked path)', async () => {
    const topCustomers = jest.fn().mockResolvedValue([safe()]);
    const ctxAdmin = makeCtx({ aiSafe: { topCustomers } as never, unmaskedPii: true });
    const res = await TOOLS_BY_NAME.get('top_customers')!.execute(ctxAdmin, { by: 'net_revenue', n: 10 });
    // Even a pii:read admin gets pseudonyms on the AI path — decryption never happens here.
    assertNoRawPii(res.data);
  });

  it('count_customers scopes every query to the asker org', async () => {
    const count = jest.fn().mockResolvedValue(7);
    const ctx = makeCtx({ prisma: { customerFeatures: { count } } as never });
    await TOOLS_BY_NAME.get('count_customers')!.execute(ctx, {});
    expect(count).toHaveBeenCalledWith({ where: { organizationId: 'org_1' } });
  });

  it('count_customers validates + translates a rule tree into a SAFE where (no raw value injection)', async () => {
    const count = jest.fn().mockResolvedValue(3);
    const ctx = makeCtx({ prisma: { customerFeatures: { count } } as never });
    const tool = TOOLS_BY_NAME.get('count_customers')!;
    const parsed = tool.paramsSchema.safeParse({ ruleTree: { op: 'AND', rules: [{ field: 'clvBand', op: 'eq', value: 'High' }] } });
    expect(parsed.success).toBe(true);
    await tool.execute(ctx, parsed.data);
    const where = count.mock.calls[0][0].where;
    expect(where.organizationId).toBe('org_1');
    // The rule became a structured Prisma filter (parameterized), not a string.
    expect(where.AND[0]).toEqual({ AND: [{ clvBand: { equals: 'High' } }] });
  });

  it('rejects an unknown rule-tree field (no arbitrary column access)', () => {
    const tool = TOOLS_BY_NAME.get('count_customers')!;
    const parsed = tool.paramsSchema.safeParse({ ruleTree: { op: 'AND', rules: [{ field: 'email', op: 'eq', value: 'x' }] } });
    expect(parsed.success).toBe(false); // field not on the whitelist
  });

  it('customer_summary is pseudonymized and org-scoped', async () => {
    const customerSummary = jest.fn().mockResolvedValue(safe({ customerId: 'c1', pseudonym: 'Customer #zzz999' }));
    const ctx = makeCtx({ aiSafe: { customerSummary } as never, unmaskedPii: false });
    const res = await TOOLS_BY_NAME.get('customer_summary')!.execute(ctx, { customerId: 'c1' });
    const data = res.data as SafeCustomer & { found: boolean };
    expect(data.found).toBe(true);
    expect(data.pseudonym).toBe('Customer #zzz999');
    expect(data).not.toHaveProperty('email');
    assertNoRawPii(res.data);
    expect(customerSummary).toHaveBeenCalledWith('org_1', 'c1');
  });

  it('exposes no mutation tool (read-only by construction)', () => {
    for (const name of TOOLS_BY_NAME.keys()) {
      expect(name).not.toMatch(/create|update|delete|send|email|enroll|merge/i);
    }
  });
});
