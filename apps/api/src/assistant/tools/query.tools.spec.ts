import { TOOLS_BY_NAME } from './query.tools';
import type { ToolContext } from './tool.types';

/**
 * The safe tool layer is the security foundation: every tool is org-scoped and
 * PII-masked BY CONSTRUCTION. These tests prove masking follows the asker's
 * role and that queries never escape the org.
 */
function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    organizationId: 'org_1',
    actorUserId: 'user_1',
    permissions: [],
    unmaskedPii: false,
    prisma: {} as never,
    analytics: {} as never,
    segments: {} as never,
    ...overrides,
  };
}

describe('safe read-only tool layer', () => {
  it('top_customers masks contact for a role without pii:read', async () => {
    const prisma = {
      customerFeatures: { findMany: jest.fn().mockResolvedValue([{ customerId: 'c1', netRevenueMinor: 5000 }]) },
      customer: { findMany: jest.fn().mockResolvedValue([{ id: 'c1', firstName: 'Jane', lastName: 'Doe', email: 'jane@nerige.co' }]) },
    };
    const ctx = makeCtx({ prisma: prisma as never, unmaskedPii: false });
    const res = await TOOLS_BY_NAME.get('top_customers')!.execute(ctx, { by: 'net_revenue', n: 10 });
    const rows = (res.data as { rows: Array<{ email: string }> }).rows;
    expect(rows[0].email).toBe('j•••@n•••.co'); // masked — never the raw address
  });

  it('top_customers returns the raw contact ONLY for a role with pii:read', async () => {
    const prisma = {
      customerFeatures: { findMany: jest.fn().mockResolvedValue([{ customerId: 'c1', netRevenueMinor: 5000 }]) },
      customer: { findMany: jest.fn().mockResolvedValue([{ id: 'c1', firstName: 'Jane', lastName: 'Doe', email: 'jane@nerige.co' }]) },
    };
    const ctx = makeCtx({ prisma: prisma as never, unmaskedPii: true });
    const res = await TOOLS_BY_NAME.get('top_customers')!.execute(ctx, { by: 'net_revenue', n: 10 });
    const rows = (res.data as { rows: Array<{ email: string }> }).rows;
    expect(rows[0].email).toBe('jane@nerige.co');
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

  it('customer_summary masks contact and is org-scoped', async () => {
    const prisma = {
      customerFeatures: { findFirst: jest.fn().mockResolvedValue({ customerId: 'c1', netRevenueMinor: 900, orderCount: 3, rSegment: 'Loyal', clvBand: 'Mid', churnBand: 'Low', daysSinceLast: 10 }) },
      customer: { findFirst: jest.fn().mockResolvedValue({ id: 'c1', firstName: 'Amit', lastName: null, email: 'amit@shop.in' }) },
    };
    const ctx = makeCtx({ prisma: prisma as never, unmaskedPii: false });
    const res = await TOOLS_BY_NAME.get('customer_summary')!.execute(ctx, { customerId: 'c1' });
    const data = res.data as { email: string };
    expect(data.email).toBe('a•••@s•••.in');
    expect(prisma.customerFeatures.findFirst).toHaveBeenCalledWith({ where: { organizationId: 'org_1', customerId: 'c1' } });
  });

  it('exposes no mutation tool (read-only by construction)', () => {
    for (const name of TOOLS_BY_NAME.keys()) {
      expect(name).not.toMatch(/create|update|delete|send|email|enroll|merge/i);
    }
  });
});
