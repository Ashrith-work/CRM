import { translateRules } from './segment.engine';
import type { RuleGroup, RuleLeaf } from '@crm/types';

describe('segment rule engine (safe translation to Prisma where)', () => {
  it('maps whitelisted fields to their columns and ops to Prisma filters', () => {
    const tree: RuleGroup = {
      op: 'AND',
      rules: [
        { field: 'rSegment', op: 'eq', value: 'Champions' },
        { field: 'totalOrders', op: 'gte', value: 3 },
        { field: 'aovMinor', op: 'lt', value: 500000 },
      ],
    };
    expect(translateRules(tree)).toEqual({
      AND: [
        { rSegment: { equals: 'Champions' } },
        { orderCount: { gte: 3 } }, // totalOrders → orderCount
        { avgOrderValueMinor: { lt: 500000 } }, // aovMinor → avgOrderValueMinor
      ],
    });
  });

  it('coerces string values on numeric fields (never trusts wire types)', () => {
    const tree: RuleGroup = { op: 'AND', rules: [{ field: 'netRevenueMinor', op: 'gt', value: '100000' }] };
    expect(translateRules(tree)).toEqual({ AND: [{ netRevenueMinor: { gt: 100000 } }] });
  });

  it('supports IN with arrays and nested OR/AND groups', () => {
    const tree: RuleGroup = {
      op: 'OR',
      rules: [
        { field: 'rSegment', op: 'in', value: ['Champions', 'Loyal'] },
        { op: 'AND', rules: [{ field: 'rScore', op: 'gte', value: 4 }, { field: 'daysSinceLast', op: 'lte', value: 30 }] },
      ],
    };
    expect(translateRules(tree)).toEqual({
      OR: [
        { rSegment: { in: ['Champions', 'Loyal'] } },
        { AND: [{ rScore: { gte: 4 } }, { daysSinceLast: { lte: 30 } }] },
      ],
    });
  });

  it('rejects a non-whitelisted field (no injection surface)', () => {
    const bad: RuleGroup = { op: 'AND', rules: [{ field: 'email; DROP TABLE', op: 'eq', value: 'x' } as unknown as RuleLeaf] };
    expect(() => translateRules(bad)).toThrow(/Unknown segment field/);
  });
});
