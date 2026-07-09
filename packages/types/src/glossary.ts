/**
 * The versioned metric glossary — the SINGLE source of truth for what a metric
 * means. The web InfoTooltip resolves a metric's tooltip from here, and the same
 * registry will later feed the AI assistant + exports, so a number never means
 * two different things in two places. M3 fills in the analytics metrics; the
 * shape + resolver are introduced here.
 */

export const GLOSSARY_VERSION = 3;

/** Definition-sync date for the metrics wired to real data (M3). */
const SYNCED = '2026-07-08';

/** Definition-sync date for the Meta ads + attribution metrics (P2.3). */
const SYNCED_ADS = '2026-07-09';

export interface GlossaryEntry {
  metricKey: string;
  /** Plain-language definition shown in the InfoTooltip. */
  plainLanguage: string;
  /** How it's computed (human-readable formula). */
  formula: string;
  /** The time window the value covers (e.g. "lifetime", "last 90 days"). */
  dataWindow: string;
  /** ISO date the definition/data was last synced (null until M3 wires real data). */
  lastSynced: string | null;
}

/** metricKey → definition. Extend (never redefine) in M3. */
export const GLOSSARY_REGISTRY: Record<string, GlossaryEntry> = {
  net_revenue: {
    metricKey: 'net_revenue',
    plainLanguage: 'Total money this customer has paid you, after refunds.',
    formula: 'Σ(order.totalMinor − order.refundedMinor) over paid/fulfilled orders',
    dataWindow: 'lifetime',
    lastSynced: SYNCED,
  },
  order_count: {
    metricKey: 'order_count',
    plainLanguage: 'How many orders this customer has placed.',
    formula: 'count(paid/fulfilled orders)',
    dataWindow: 'lifetime',
    lastSynced: SYNCED,
  },
  avg_order_value: {
    metricKey: 'avg_order_value',
    plainLanguage: 'Average net value of an order for this customer.',
    formula: 'net_revenue ÷ order_count',
    dataWindow: 'lifetime',
    lastSynced: SYNCED,
  },
  last_order: {
    metricKey: 'last_order',
    plainLanguage: 'When this customer most recently ordered.',
    formula: 'max(order.placedAt) over paid/fulfilled orders',
    dataWindow: 'lifetime',
    lastSynced: SYNCED,
  },
  // RFM — real (nightly materialized view + refresh worker).
  rfm: {
    metricKey: 'rfm',
    plainLanguage: 'Recency/Frequency/Monetary segment — how recently, how often, and how much a customer buys, as a named segment (e.g. Champions, At Risk).',
    formula: 'NTILE(5) quintiles of recency (recent=5), frequency, and monetary; mapped to a segment by a fixed matrix',
    dataWindow: 'lifetime (nightly refresh)',
    lastSynced: SYNCED,
  },
  recovery_rate: {
    metricKey: 'recovery_rate',
    plainLanguage: 'Share of abandoned carts that were recovered — the customer placed a qualifying order after being enrolled in the recovery sequence, within the attribution window.',
    formula: 'recovered_carts ÷ abandoned_carts (enrolled)',
    dataWindow: 'attribution window (default 7 days)',
    lastSynced: SYNCED,
  },
  recovered_revenue: {
    metricKey: 'recovered_revenue',
    plainLanguage: 'Net revenue from orders that recovered an abandoned cart.',
    formula: 'Σ(order.totalMinor − order.refundedMinor) for recovered carts',
    dataWindow: 'attribution window (default 7 days)',
    lastSynced: SYNCED,
  },
  // CLV / churn / cohort / margin — real (P2.1, heuristic; predictive is Phase 3).
  clv: {
    metricKey: 'clv',
    plainLanguage: 'Customer lifetime value — total net revenue this customer has generated so far (MVP = historical, not predicted).',
    formula: 'Σ(order.totalMinor − order.refundedMinor) over paid/fulfilled; banded High/Mid/Low by tertile',
    dataWindow: 'lifetime (nightly refresh)',
    lastSynced: SYNCED,
  },
  churn_risk: {
    metricKey: 'churn_risk',
    plainLanguage: 'How overdue a customer is versus their own buying rhythm — a transparent, non-ML flag.',
    formula: 'daysSinceLast ÷ median inter-purchase gap: ≤1×=Low, ≤2×=Medium, >2×=High; <2 orders=Unknown',
    dataWindow: 'lifetime (weekly refresh)',
    lastSynced: SYNCED,
  },
  cohort: {
    metricKey: 'cohort',
    plainLanguage: 'Customers grouped by their first-purchase month; retention = the share still ordering in each later month.',
    formula: 'per cohort × period: distinct active customers ÷ cohort size (period 0 = acquisition month)',
    dataWindow: 'lifetime (nightly refresh)',
    lastSynced: SYNCED,
  },
  contribution_margin: {
    metricKey: 'contribution_margin',
    plainLanguage: 'What each sale contributes after variable costs. Real when per-SKU COGS exists; otherwise an ESTIMATE that excludes COGS.',
    formula: 'net revenue − COGS (when hasCogs); else "Estimated margin (excludes COGS)" = net revenue (discount- and return-adjusted)',
    dataWindow: 'daily (org timezone, nightly refresh)',
    lastSynced: SYNCED,
  },
  apparel_size: { metricKey: 'apparel_size', plainLanguage: "The customer's most-ordered apparel size.", formula: 'mode(order_item.variant size)', dataWindow: 'lifetime', lastSynced: null },
  fit: { metricKey: 'fit', plainLanguage: 'Preferred fit inferred from purchases/returns.', formula: 'derived in M3', dataWindow: 'lifetime', lastSynced: null },
  style_affinity: { metricKey: 'style_affinity', plainLanguage: 'Style/category the customer gravitates to.', formula: 'derived in M3', dataWindow: 'lifetime', lastSynced: null },

  // P2.3 — Meta ads + attribution. Money is store-actual (paise) except where a
  // metric is explicitly Meta-reported (conversions). Attribution buckets on
  // FIRST-TOUCH by default; the model is always labelled in the UI.
  roas: {
    metricKey: 'roas',
    plainLanguage: 'Return on ad spend — store-actual revenue earned per unit of ad spend, by acquisition source.',
    formula: 'store-actual net revenue (first-touch attributed) ÷ ad spend',
    dataWindow: 'lifetime of acquired customers / spend to date',
    lastSynced: SYNCED_ADS,
  },
  cac: {
    metricKey: 'cac',
    plainLanguage: 'Customer acquisition cost — ad spend divided by the number of customers that source first-touch acquired.',
    formula: 'spend(source) ÷ customers_acquired(source, first-touch)',
    dataWindow: 'to date',
    lastSynced: SYNCED_ADS,
  },
  ltv_cac: {
    metricKey: 'ltv_cac',
    plainLanguage: 'Lifetime value relative to acquisition cost. Above ~3 is healthy; below 1 means a source loses money.',
    formula: 'avg store-actual net revenue per acquired customer ÷ CAC (first-touch bucketed)',
    dataWindow: 'lifetime / to date',
    lastSynced: SYNCED_ADS,
  },
  payback: {
    metricKey: 'payback',
    plainLanguage: 'CAC payback period — months of the source cohort’s average revenue needed to recover its acquisition cost.',
    formula: 'CAC ÷ (avg net revenue per customer ÷ active months of the source cohort)',
    dataWindow: 'to date',
    lastSynced: SYNCED_ADS,
  },
  first_touch: {
    metricKey: 'first_touch',
    plainLanguage: 'The FIRST channel/source that brought a customer in. We store every touchpoint but bucket acquisition on the first one — deliberately, so we do not over-trust last-click.',
    formula: 'earliest Touchpoint.source per customer (Meta ad, or landing UTM via Shopify cart attributes; else "unknown")',
    dataWindow: 'lifetime',
    lastSynced: SYNCED_ADS,
  },
  conversions: {
    metricKey: 'conversions',
    plainLanguage: 'Purchases attributed to ads. Meta REPORTS these and typically OVER-reports; we show Meta-reported next to store-actual orders and prefer store-actual for revenue.',
    formula: 'Meta-reported: Insights "conversions". Store-actual: paid/fulfilled Orders for first-touch-Meta customers',
    dataWindow: 'daily (Meta) / lifetime (store)',
    lastSynced: SYNCED_ADS,
  },
  attribution_coverage: {
    metricKey: 'attribution_coverage',
    plainLanguage: 'Share of acquired customers whose first-touch source is known (not "unknown"). Missing UTMs (Shopify default) lower coverage — we never fabricate a source.',
    formula: 'customers with a non-"unknown" first-touch ÷ all acquired customers',
    dataWindow: 'lifetime',
    lastSynced: SYNCED_ADS,
  },
  vip_tier: {
    metricKey: 'vip_tier',
    plainLanguage: 'The customer\'s value tier (VIP / Gold / Silver / Standard), assigned from lifetime value (or total spend as a fallback) against configured thresholds.',
    formula: 'band of CLV (or net revenue when CLV is unset) against VIP/Gold/Silver thresholds',
    dataWindow: 'lifetime (nightly refresh)',
    lastSynced: SYNCED_ADS,
  },
};

/** Resolve a metric's glossary entry, or null if unknown. */
export function resolveGlossary(metricKey: string): GlossaryEntry | null {
  return GLOSSARY_REGISTRY[metricKey] ?? null;
}
