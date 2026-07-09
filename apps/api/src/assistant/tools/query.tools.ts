import { z } from 'zod';
import { RuleGroupSchema, type RuleGroup } from '@crm/types';
import { maskEmail } from '../../common/pii.util';
import { translateRules } from '../../segments/segment.engine';
import type { Prisma } from '@prisma/client';
import type { AssistantTool, ToolContext, ToolResult } from './tool.types';

/**
 * The CURATED, whitelisted read-only tool layer — the security foundation.
 * Every tool: validates its params, runs READ-ONLY, is scoped to ctx.org + role
 * (PII masked unless ctx.unmaskedPii), and returns already-safe structured data.
 * There is no free-form SQL and no mutation tool anywhere in here.
 */

// A compact JSON Schema for the whitelisted rule tree (M3's safe engine). The
// engine whitelists fields + ops, so even a hostile tree can't inject.
const RULE_TREE_JSON_SCHEMA = {
  type: 'object',
  description:
    'A filter over customer features. Fields: rSegment, daysSinceLast, totalOrders, netRevenueMinor, aovMinor, clvBand, churnBand, rScore, fScore, mScore. Ops: eq, in, gt, gte, lt, lte. Money is integer minor units (paise).',
  properties: {
    op: { type: 'string', enum: ['AND', 'OR'] },
    rules: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string' },
          op: { type: 'string' },
          value: {},
        },
      },
    },
  },
  required: ['op', 'rules'],
} as const;

function orgScopedWhere(organizationId: string, rules?: RuleGroup): Prisma.CustomerFeaturesWhereInput {
  return rules ? { organizationId, AND: [translateRules(rules)] } : { organizationId };
}

// ---------------------------------------------------------------------------
// count_customers — how many customers match an optional filter.
// ---------------------------------------------------------------------------
const countCustomers: AssistantTool = {
  name: 'count_customers',
  description:
    'Count customers, optionally filtered by a rule tree (segment, RFM band, CLV band, churn band, order count, spend, recency). Use for "how many..." questions.',
  metricKeys: [],
  paramsSchema: z.object({ ruleTree: RuleGroupSchema.optional() }),
  inputSchema: {
    type: 'object',
    properties: { ruleTree: RULE_TREE_JSON_SCHEMA },
    required: [],
  },
  async execute(ctx: ToolContext, params: unknown): Promise<ToolResult> {
    const { ruleTree } = params as { ruleTree?: RuleGroup };
    const count = await ctx.prisma.customerFeatures.count({ where: orgScopedWhere(ctx.organizationId, ruleTree) });
    return {
      data: { count },
      rowCount: 1,
      ...(ruleTree ? { segmentHandoff: { label: 'Matching customers', rules: ruleTree } } : {}),
    };
  },
};

// ---------------------------------------------------------------------------
// top_customers — the top N by a whitelisted metric (masked contact).
// ---------------------------------------------------------------------------
const TOP_BY: Record<string, { col: 'netRevenueMinor' | 'orderCount' | 'clvMinor'; metricKey: string }> = {
  net_revenue: { col: 'netRevenueMinor', metricKey: 'net_revenue' },
  orders: { col: 'orderCount', metricKey: 'order_count' },
  clv: { col: 'clvMinor', metricKey: 'clv' },
};
const topCustomers: AssistantTool = {
  name: 'top_customers',
  description: 'List the top N customers ranked by net_revenue, orders, or clv. Returns name, masked contact, and the value.',
  metricKeys: ['net_revenue', 'order_count', 'clv'],
  paramsSchema: z.object({
    by: z.enum(['net_revenue', 'orders', 'clv']).default('net_revenue'),
    n: z.number().int().min(1).max(25).default(10),
  }),
  inputSchema: {
    type: 'object',
    properties: {
      by: { type: 'string', enum: ['net_revenue', 'orders', 'clv'] },
      n: { type: 'integer', minimum: 1, maximum: 25 },
    },
    required: [],
  },
  async execute(ctx: ToolContext, params: unknown): Promise<ToolResult> {
    const { by, n } = params as { by: keyof typeof TOP_BY; n: number };
    const cfg = TOP_BY[by];
    const feats = await ctx.prisma.customerFeatures.findMany({
      where: { organizationId: ctx.organizationId, [cfg.col]: { not: null } },
      orderBy: { [cfg.col]: 'desc' },
      take: n,
    });
    const customers = await ctx.prisma.customer.findMany({
      where: { organizationId: ctx.organizationId, id: { in: feats.map((f) => f.customerId) } },
    });
    const byId = new Map(customers.map((c) => [c.id, c]));
    const rows = feats.map((f) => {
      const c = byId.get(f.customerId);
      const name = c ? [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || f.customerId : f.customerId;
      return {
        name,
        email: c ? (ctx.unmaskedPii ? c.email : maskEmail(c.email)) : null,
        value: (f as Record<string, unknown>)[cfg.col] ?? 0,
        metric: by,
      };
    });
    return { data: { by, rows }, rowCount: rows.length };
  },
};

// ---------------------------------------------------------------------------
// rfm_summary — RFM segment distribution + totals.
// ---------------------------------------------------------------------------
const rfmSummary: AssistantTool = {
  name: 'rfm_summary',
  description: 'The RFM (Recency/Frequency/Monetary) segment distribution and totals for the org.',
  metricKeys: ['rfm', 'net_revenue', 'avg_order_value'],
  paramsSchema: z.object({}),
  inputSchema: { type: 'object', properties: {}, required: [] },
  async execute(ctx: ToolContext): Promise<ToolResult> {
    const summary = await ctx.analytics.summary(ctx.organizationId);
    return { data: summary, rowCount: summary.distribution.length };
  },
};

// ---------------------------------------------------------------------------
// revenue_trend — daily net revenue trend (summarized, not row-dumped).
// ---------------------------------------------------------------------------
const revenueTrend: AssistantTool = {
  name: 'revenue_trend',
  description: 'Daily net revenue trend. Returns total, day count, and first/last day (summarized, not every row).',
  metricKeys: ['net_revenue'],
  paramsSchema: z.object({}),
  inputSchema: { type: 'object', properties: {}, required: [] },
  async execute(ctx: ToolContext): Promise<ToolResult> {
    const trend = await ctx.analytics.revenueTrend(ctx.organizationId);
    const total = trend.data.reduce((s, p) => s + p.netRevenueMinor, 0);
    const orders = trend.data.reduce((s, p) => s + p.orderCount, 0);
    return {
      data: {
        currency: trend.currency,
        totalNetRevenueMinor: total,
        totalOrders: orders,
        days: trend.data.length,
        firstDay: trend.data[0]?.day ?? null,
        lastDay: trend.data[trend.data.length - 1]?.day ?? null,
      },
      rowCount: trend.data.length,
    };
  },
};

// ---------------------------------------------------------------------------
// cohort_retention — cohort retention summary.
// ---------------------------------------------------------------------------
const cohortRetention: AssistantTool = {
  name: 'cohort_retention',
  description: 'Cohort retention: for each acquisition-month cohort, its size and retention at later periods (summarized).',
  metricKeys: ['cohort'],
  paramsSchema: z.object({}),
  inputSchema: { type: 'object', properties: {}, required: [] },
  async execute(ctx: ToolContext): Promise<ToolResult> {
    const cohorts = await ctx.analytics.cohorts(ctx.organizationId);
    // Summarize: cohort month, size, and period-1 retention only (avoid dumping the full grid).
    const rows = cohorts.data.map((r) => ({
      cohortMonth: r.cohortMonth,
      cohortSize: r.cohortSize,
      period1RetentionPct: r.cells.find((c) => c.periodNumber === 1)?.retentionPct ?? null,
    }));
    return { data: { maxPeriod: cohorts.maxPeriod, cohorts: rows }, rowCount: rows.length };
  },
};

// ---------------------------------------------------------------------------
// clv_distribution — CLV band distribution.
// ---------------------------------------------------------------------------
const clvDistribution: AssistantTool = {
  name: 'clv_distribution',
  description: 'Customer lifetime value banded into High/Mid/Low: how many customers and total value per band.',
  metricKeys: ['clv'],
  paramsSchema: z.object({}),
  inputSchema: { type: 'object', properties: {}, required: [] },
  async execute(ctx: ToolContext): Promise<ToolResult> {
    const dist = await ctx.analytics.clvDistribution(ctx.organizationId);
    return { data: dist, rowCount: dist.data.length };
  },
};

// ---------------------------------------------------------------------------
// churn_watchlist — at-risk customers (already masked by the analytics service).
// ---------------------------------------------------------------------------
const churnWatchlist: AssistantTool = {
  name: 'churn_watchlist',
  description: 'Customers most at risk of churning (High/Medium churn band), ranked by value. Contact is masked unless you have pii:read.',
  metricKeys: ['churn_risk', 'clv'],
  paramsSchema: z.object({ limit: z.number().int().min(1).max(50).default(20) }),
  inputSchema: {
    type: 'object',
    properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } },
    required: [],
  },
  async execute(ctx: ToolContext, params: unknown): Promise<ToolResult> {
    const { limit } = params as { limit: number };
    const watch = await ctx.analytics.churnWatchlist(ctx.organizationId, ctx.unmaskedPii, limit);
    return {
      data: watch,
      rowCount: watch.data.length,
      segmentHandoff: {
        label: 'At-risk customers (High/Medium churn)',
        rules: { op: 'OR', rules: [{ field: 'churnBand', op: 'eq', value: 'High' }, { field: 'churnBand', op: 'eq', value: 'Medium' }] },
      },
    };
  },
};

// ---------------------------------------------------------------------------
// margin_summary — contribution margin (labelled estimate when no COGS).
// ---------------------------------------------------------------------------
const marginSummary: AssistantTool = {
  name: 'margin_summary',
  description: 'Contribution margin over time. When per-SKU COGS is missing this is a labelled ESTIMATE that excludes COGS.',
  metricKeys: ['contribution_margin'],
  paramsSchema: z.object({}),
  inputSchema: { type: 'object', properties: {}, required: [] },
  async execute(ctx: ToolContext): Promise<ToolResult> {
    const margin = await ctx.analytics.margin(ctx.organizationId);
    return {
      data: { isEstimate: margin.isEstimate, label: margin.label, currency: margin.currency, totalMarginMinor: margin.totalMarginMinor, days: margin.data.length },
      rowCount: margin.data.length,
    };
  },
};

// ---------------------------------------------------------------------------
// segment_preview — count + masked sample for a rule tree (M3 engine).
// ---------------------------------------------------------------------------
const segmentPreview: AssistantTool = {
  name: 'segment_preview',
  description: 'Preview a segment defined by a rule tree: the matching count and a small masked sample. Use when a question describes a group of customers.',
  metricKeys: ['rfm'],
  paramsSchema: z.object({ ruleTree: RuleGroupSchema }),
  inputSchema: { type: 'object', properties: { ruleTree: RULE_TREE_JSON_SCHEMA }, required: ['ruleTree'] },
  async execute(ctx: ToolContext, params: unknown): Promise<ToolResult> {
    const { ruleTree } = params as { ruleTree: RuleGroup };
    const preview = await ctx.segments.preview(ctx.organizationId, ruleTree, ctx.unmaskedPii);
    return {
      data: { count: preview.count, sampleSize: preview.sample.length, sample: preview.sample.slice(0, 5) },
      rowCount: preview.count,
      segmentHandoff: { label: 'Previewed segment', rules: ruleTree },
    };
  },
};

// ---------------------------------------------------------------------------
// customer_summary — one customer's features (masked contact).
// ---------------------------------------------------------------------------
const customerSummary: AssistantTool = {
  name: 'customer_summary',
  description: 'A single customer’s summary by customerId: spend, orders, RFM segment, CLV band, churn band. Contact is masked unless you have pii:read.',
  metricKeys: ['net_revenue', 'order_count', 'rfm', 'clv', 'churn_risk'],
  paramsSchema: z.object({ customerId: z.string().min(1) }),
  inputSchema: { type: 'object', properties: { customerId: { type: 'string' } }, required: ['customerId'] },
  async execute(ctx: ToolContext, params: unknown): Promise<ToolResult> {
    const { customerId } = params as { customerId: string };
    const f = await ctx.prisma.customerFeatures.findFirst({ where: { organizationId: ctx.organizationId, customerId } });
    if (!f) return { data: { found: false }, rowCount: 0 };
    const c = await ctx.prisma.customer.findFirst({ where: { organizationId: ctx.organizationId, id: customerId } });
    return {
      data: {
        found: true,
        name: c ? [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || customerId : customerId,
        email: c ? (ctx.unmaskedPii ? c.email : maskEmail(c.email)) : null,
        netRevenueMinor: f.netRevenueMinor,
        orderCount: f.orderCount,
        rSegment: f.rSegment,
        clvBand: f.clvBand,
        churnBand: f.churnBand,
        daysSinceLast: f.daysSinceLast,
      },
      rowCount: 1,
    };
  },
};

/** The complete registry. READ-ONLY by construction — no mutation tool exists. */
export const ASSISTANT_TOOLS: AssistantTool[] = [
  countCustomers,
  topCustomers,
  rfmSummary,
  revenueTrend,
  cohortRetention,
  clvDistribution,
  churnWatchlist,
  marginSummary,
  segmentPreview,
  customerSummary,
];

export const TOOLS_BY_NAME: Map<string, AssistantTool> = new Map(ASSISTANT_TOOLS.map((t) => [t.name, t]));
