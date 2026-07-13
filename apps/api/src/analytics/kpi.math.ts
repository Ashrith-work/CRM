import type { KpiMetric } from '@crm/types';

/**
 * PURE KPI math — computes the dashboard commerce KPIs from pre-aggregated
 * inputs (the commerce_kpi_daily rollup summed over a period + customer
 * aggregates). No DB, no I/O → golden-testable. Money is integer minor units;
 * rates are fractions in [0,1] and are `null` when their denominator is zero
 * (division-by-zero guard, matching the dashboard convention).
 */

/** One day of the commerce_kpi_daily materialized view. */
export interface KpiDailyRow {
  net_minor: number;
  gross_minor: number;
  refunded_minor: number;
  discount_minor: number;
  order_count: number;
  refund_order_count: number;
  discount_order_count: number;
  new_customer_count: number;
}

/** Period sums of the daily rollup. */
export interface KpiSums {
  netMinor: number;
  grossMinor: number;
  refundedMinor: number;
  discountMinor: number;
  orderCount: number;
  refundOrderCount: number;
  discountOrderCount: number;
  newCustomers: number;
}

/** Customer-level aggregates that a daily rollup can't express. */
export interface KpiCustomerAgg {
  /** Distinct customers with ≥1 order IN the period. */
  activeCustomers: number;
  /** Of the active customers, how many placed an order BEFORE the period. */
  returningCustomers: number;
  /** Lifetime: customers with ≥1 paid/fulfilled order (repeat-rate denominator). */
  buyersLifetime: number;
  /** Lifetime: customers with ≥2 paid/fulfilled orders (repeat-rate numerator). */
  repeatBuyersLifetime: number;
  /** All customers on file (Customer.count) — a standing total, not period-scoped. */
  totalCustomers: number;
}

export function sumDaily(rows: KpiDailyRow[]): KpiSums {
  const s: KpiSums = {
    netMinor: 0, grossMinor: 0, refundedMinor: 0, discountMinor: 0,
    orderCount: 0, refundOrderCount: 0, discountOrderCount: 0, newCustomers: 0,
  };
  for (const r of rows) {
    s.netMinor += r.net_minor;
    s.grossMinor += r.gross_minor;
    s.refundedMinor += r.refunded_minor;
    s.discountMinor += r.discount_minor;
    s.orderCount += r.order_count;
    s.refundOrderCount += r.refund_order_count;
    s.discountOrderCount += r.discount_order_count;
    s.newCustomers += r.new_customer_count;
  }
  return s;
}

/** Safe ratio → fraction in [0,1] or null when the denominator is zero. */
function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/** Compute all KPI metrics for a period from its sums + customer aggregates,
 *  plus the same for the previous period (for the delta). Returns them in the
 *  order the tile row renders. */
export function buildKpiMetrics(
  cur: KpiSums,
  curCust: KpiCustomerAgg,
  prev: KpiSums,
  prevCust: KpiCustomerAgg,
): KpiMetric[] {
  const aov = (s: KpiSums): number | null => (s.orderCount > 0 ? Math.round(s.netMinor / s.orderCount) : null);
  const refundRate = (s: KpiSums): number | null => rate(s.refundedMinor, s.grossMinor);
  const returningRate = (c: KpiCustomerAgg): number | null => rate(c.returningCustomers, c.activeCustomers);
  const repeatRate = (c: KpiCustomerAgg): number | null => rate(c.repeatBuyersLifetime, c.buyersLifetime);
  const discountUsage = (s: KpiSums): number | null => rate(s.discountOrderCount, s.orderCount);
  const avgOrders = (s: KpiSums, c: KpiCustomerAgg): number | null =>
    c.activeCustomers > 0 ? s.orderCount / c.activeCustomers : null;

  const m = (
    key: string,
    label: string,
    unit: KpiMetric['unit'],
    value: number | null,
    previous: number | null,
    betterWhenLower = false,
  ): KpiMetric => ({ key, label, unit, value, previous, betterWhenLower });

  return [
    m('net_revenue', 'Net revenue', 'money', cur.netMinor, prev.netMinor),
    m('order_count', 'Orders', 'count', cur.orderCount, prev.orderCount),
    m('avg_order_value', 'Avg order value', 'money', aov(cur), aov(prev)),
    m('repeat_purchase_rate', 'Repeat-purchase rate', 'rate', repeatRate(curCust), null), // lifetime → no period delta
    m('returning_rate', 'Returning customers', 'rate', returningRate(curCust), returningRate(prevCust)),
    m('refund_rate', 'Refund rate', 'rate', refundRate(cur), refundRate(prev), true),
    m('new_customers', 'New customers', 'count', cur.newCustomers, prev.newCustomers),
    m('discount_usage_rate', 'Discount usage', 'rate', discountUsage(cur), discountUsage(prev)),
    // Secondary tiles.
    m('active_customers', 'Active customers', 'count', curCust.activeCustomers, prevCust.activeCustomers),
    m('avg_orders_per_customer', 'Orders / customer', 'ratio', avgOrders(cur, curCust), avgOrders(prev, prevCust)),
    m('discount_value', 'Discount value', 'money', cur.discountMinor, prev.discountMinor, true),
    m('total_customers', 'Total customers', 'count', curCust.totalCustomers, null), // standing total
  ];
}
