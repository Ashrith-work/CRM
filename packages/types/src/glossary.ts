/**
 * The versioned metric glossary — the SINGLE source of truth for what a metric
 * means. The web InfoTooltip resolves a metric's tooltip from here, and the same
 * registry will later feed the AI assistant + exports, so a number never means
 * two different things in two places. M3 fills in the analytics metrics; the
 * shape + resolver are introduced here.
 */

export const GLOSSARY_VERSION = 1;

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
    formula: 'Σ(order.totalMinor − order.refundedMinor) across all orders',
    dataWindow: 'lifetime',
    lastSynced: null,
  },
  order_count: {
    metricKey: 'order_count',
    plainLanguage: 'How many orders this customer has placed.',
    formula: 'count(orders)',
    dataWindow: 'lifetime',
    lastSynced: null,
  },
  avg_order_value: {
    metricKey: 'avg_order_value',
    plainLanguage: 'Average net value of an order for this customer.',
    formula: 'net_revenue ÷ order_count',
    dataWindow: 'lifetime',
    lastSynced: null,
  },
  last_order: {
    metricKey: 'last_order',
    plainLanguage: 'When this customer most recently ordered.',
    formula: 'max(order.placedAt)',
    dataWindow: 'lifetime',
    lastSynced: null,
  },
  // Placeholders — populated by M3 analytics (badges show "—" until then).
  rfm: {
    metricKey: 'rfm',
    plainLanguage: 'Recency/Frequency/Monetary segment — how recently, how often, and how much this customer buys.',
    formula: 'quintile(recency) · quintile(frequency) · quintile(monetary)',
    dataWindow: 'lifetime',
    lastSynced: null,
  },
  clv: {
    metricKey: 'clv',
    plainLanguage: 'Predicted lifetime value — expected total net revenue from this customer.',
    formula: 'model(order history) — computed in M3',
    dataWindow: 'predicted',
    lastSynced: null,
  },
  churn_risk: {
    metricKey: 'churn_risk',
    plainLanguage: 'Likelihood this customer has stopped buying.',
    formula: 'model(recency, cadence) — computed in M3',
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
