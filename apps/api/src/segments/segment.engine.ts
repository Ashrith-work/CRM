import { BadRequestException } from '@nestjs/common';
import type { RuleGroup, RuleLeaf, SegmentField } from '@crm/types';
import type { Prisma } from '@prisma/client';

/**
 * Translate a JSON rule tree into a SAFE parameterized Prisma `where` over
 * CustomerFeatures. Fields + operators are WHITELISTED and values are coerced;
 * the tree is turned into Prisma's structured filter (which parameterizes every
 * value) — NEVER string-concatenated or eval'd, so it can't inject SQL.
 */

interface Column {
  col: string;
  numeric: boolean;
}

// Whitelist: rule field → CustomerFeatures column.
const FIELD_COLUMN: Record<SegmentField, Column> = {
  rSegment: { col: 'rSegment', numeric: false },
  daysSinceLast: { col: 'daysSinceLast', numeric: true },
  totalOrders: { col: 'orderCount', numeric: true },
  netRevenueMinor: { col: 'netRevenueMinor', numeric: true },
  aovMinor: { col: 'avgOrderValueMinor', numeric: true },
  clvBand: { col: 'clvBand', numeric: false }, // real: High | Mid | Low
  churnBand: { col: 'churnBand', numeric: false }, // Low | Medium | High | Unknown
  rScore: { col: 'rScore', numeric: true },
  fScore: { col: 'fScore', numeric: true },
  mScore: { col: 'mScore', numeric: true },
};

const OP_MAP: Record<string, 'equals' | 'gt' | 'gte' | 'lt' | 'lte'> = {
  eq: 'equals',
  gt: 'gt',
  gte: 'gte',
  lt: 'lt',
  lte: 'lte',
};

function coerce(value: unknown, numeric: boolean): string | number {
  return numeric ? Number(value) : String(value);
}

function leafToWhere(leaf: RuleLeaf): Record<string, unknown> {
  const column = FIELD_COLUMN[leaf.field];
  if (!column) throw new BadRequestException(`Unknown segment field: ${leaf.field}`);

  if (leaf.op === 'in') {
    const arr = (Array.isArray(leaf.value) ? leaf.value : [leaf.value]).map((v) => coerce(v, column.numeric));
    return { [column.col]: { in: arr } };
  }
  const prismaOp = OP_MAP[leaf.op];
  if (!prismaOp) throw new BadRequestException(`Unknown operator: ${leaf.op}`);
  return { [column.col]: { [prismaOp]: coerce(leaf.value, column.numeric) } };
}

function isLeaf(node: RuleLeaf | RuleGroup): node is RuleLeaf {
  return 'field' in node;
}

/** Recursively translate the tree; caller wraps with the org scope. */
export function translateRules(tree: RuleGroup): Prisma.CustomerFeaturesWhereInput {
  const parts = tree.rules.map((node) => (isLeaf(node) ? leafToWhere(node) : translateRules(node)));
  return (tree.op === 'OR' ? { OR: parts } : { AND: parts }) as Prisma.CustomerFeaturesWhereInput;
}
