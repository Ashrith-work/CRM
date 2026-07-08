/**
 * The versioned metric glossary — the SINGLE source of truth for what a metric
 * means. The web InfoTooltip resolves a metric's tooltip from here, and the same
 * registry will later feed the AI assistant + exports, so a number never means
 * two different things in two places. M3 fills in the analytics metrics; the
 * shape + resolver are introduced here.
 */

export const GLOSSARY_VERSION = 2;

/** Definition-sync date for the metrics wired to real data (M3). */
const SYNCED = '2026-07-08';

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
  // Stubs — Phase 2.
  clv: {
    metricKey: 'clv',
    plainLanguage: 'Predicted lifetime value — expected total net revenue from this customer.',
    formula: 'model(order history) — stub in this phase',
    dataWindow: 'predicted',
    lastSynced: null,
  },
  churn_risk: {
    metricKey: 'churn_risk',
    plainLanguage: 'Likelihood this customer has stopped buying.',
    formula: 'model(recency, cadence) — stub in this phase',
    dataWindow: 'predicted',
    lastSynced: null,
  },
  cohort: {
    metricKey: 'cohort',
    plainLanguage: 'Customers grouped by the month of their first order, to compare retention over time.',
    formula: 'group by month(first_order) — stub in this phase',
    dataWindow: 'lifetime',
    lastSynced: null,
  },
  ltv_cac: {
    metricKey: 'ltv_cac',
    plainLanguage: 'Lifetime value relative to what it costs to acquire a customer.',
    formula: 'clv ÷ acquisition_cost — stub in this phase',
    dataWindow: 'predicted',
    lastSynced: null,
  },
  apparel_size: { metricKey: 'apparel_size', plainLanguage: "The customer's most-ordered apparel size.", formula: 'mode(order_item.variant size)', dataWindow: 'lifetime', lastSynced: null },
  fit: { metricKey: 'fit', plainLanguage: 'Preferred fit inferred from purchases/returns.', formula: 'derived in M3', dataWindow: 'lifetime', lastSynced: null },
  style_affinity: { metricKey: 'style_affinity', plainLanguage: 'Style/category the customer gravitates to.', formula: 'derived in M3', dataWindow: 'lifetime', lastSynced: null },
};

/** Resolve a metric's glossary entry, or null if unknown. */
export function resolveGlossary(metricKey: string): GlossaryEntry | null {
  return GLOSSARY_REGISTRY[metricKey] ?? null;
}
