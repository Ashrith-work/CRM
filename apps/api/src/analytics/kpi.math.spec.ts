import { buildKpiMetrics, sumDaily, type KpiCustomerAgg, type KpiDailyRow } from './kpi.math';
import { resolvePeriod, previousPeriod } from '../dashboard/dashboard.period';

/** Find a metric by its glossary key. */
function metric(metrics: ReturnType<typeof buildKpiMetrics>, key: string) {
  const m = metrics.find((x) => x.key === key);
  if (!m) throw new Error(`no metric ${key}`);
  return m;
}

describe('KPI math (golden dataset)', () => {
  // A 3-day period with a refund (day 2) and a mix of new/returning buyers.
  const d = (o: Partial<KpiDailyRow>): KpiDailyRow => ({
    net_minor: 0, gross_minor: 0, refunded_minor: 0, discount_minor: 0,
    order_count: 0, refund_order_count: 0, discount_order_count: 0, new_customer_count: 0, ...o,
  });
  const current: KpiDailyRow[] = [
    d({ order_count: 2, gross_minor: 20000, net_minor: 20000, discount_minor: 5000, discount_order_count: 1, new_customer_count: 2 }),
    d({ order_count: 1, gross_minor: 10000, net_minor: 6000, refunded_minor: 4000, refund_order_count: 1, new_customer_count: 0 }),
    d({ order_count: 1, gross_minor: 5000, net_minor: 5000, new_customer_count: 1 }),
  ];
  // 3 distinct active customers (one ordered twice); 1 of them had ordered before.
  const curCust: KpiCustomerAgg = {
    activeCustomers: 3, returningCustomers: 1,
    buyersLifetime: 10, repeatBuyersLifetime: 4, totalCustomers: 12,
  };
  const previous: KpiDailyRow[] = [d({ order_count: 2, gross_minor: 10000, net_minor: 10000, new_customer_count: 1 })];
  const prevCust: KpiCustomerAgg = {
    activeCustomers: 2, returningCustomers: 0,
    buyersLifetime: 10, repeatBuyersLifetime: 4, totalCustomers: 12,
  };

  const metrics = buildKpiMetrics(sumDaily(current), curCust, sumDaily(previous), prevCust);

  it('sums the daily rollup correctly', () => {
    const s = sumDaily(current);
    expect(s.orderCount).toBe(4);
    expect(s.grossMinor).toBe(35000);
    expect(s.netMinor).toBe(31000);
    expect(s.refundedMinor).toBe(4000);
    expect(s.discountMinor).toBe(5000);
    expect(s.newCustomers).toBe(3);
  });

  it('net revenue = Σ(total − refunded), refund-adjusted', () => {
    expect(metric(metrics, 'net_revenue').value).toBe(31000);
    expect(metric(metrics, 'net_revenue').previous).toBe(10000);
  });

  it('AOV = net ÷ orders (rounded)', () => {
    expect(metric(metrics, 'avg_order_value').value).toBe(7750); // 31000/4
    expect(metric(metrics, 'avg_order_value').previous).toBe(5000); // 10000/2
  });

  it('refund rate = refunded ÷ gross, and is flagged lower-is-better', () => {
    const m = metric(metrics, 'refund_rate');
    expect(m.value).toBeCloseTo(4000 / 35000, 10); // ≈ 0.1143
    expect(m.betterWhenLower).toBe(true);
    expect(m.previous).toBe(0); // no refunds in the previous period
  });

  it('repeat-purchase rate = ≥2 orders ÷ ≥1 (lifetime), single-order buyers count in the denominator only', () => {
    const m = metric(metrics, 'repeat_purchase_rate');
    expect(m.value).toBeCloseTo(0.4, 10); // 4/10
    expect(m.previous).toBeNull(); // lifetime metric — no period delta
  });

  it('returning % = returning ÷ active in the period', () => {
    expect(metric(metrics, 'returning_rate').value).toBeCloseTo(1 / 3, 10);
    expect(metric(metrics, 'returning_rate').previous).toBe(0); // 0/2
  });

  it('discount usage = discounted orders ÷ orders', () => {
    expect(metric(metrics, 'discount_usage_rate').value).toBeCloseTo(0.25, 10); // 1/4
  });

  it('new customers + avg orders per customer', () => {
    expect(metric(metrics, 'new_customers').value).toBe(3);
    expect(metric(metrics, 'avg_orders_per_customer').value).toBeCloseTo(4 / 3, 10);
  });

  it('total customers is a standing total with no delta', () => {
    expect(metric(metrics, 'total_customers').value).toBe(12);
    expect(metric(metrics, 'total_customers').previous).toBeNull();
  });

  it('guards division by zero → null rates for an empty period', () => {
    const empty = sumDaily([]);
    const emptyCust: KpiCustomerAgg = { activeCustomers: 0, returningCustomers: 0, buyersLifetime: 0, repeatBuyersLifetime: 0, totalCustomers: 0 };
    const m = buildKpiMetrics(empty, emptyCust, empty, emptyCust);
    expect(metric(m, 'avg_order_value').value).toBeNull();
    expect(metric(m, 'refund_rate').value).toBeNull();
    expect(metric(m, 'returning_rate').value).toBeNull();
    expect(metric(m, 'repeat_purchase_rate').value).toBeNull();
    expect(metric(m, 'discount_usage_rate').value).toBeNull();
    expect(metric(m, 'net_revenue').value).toBe(0);
  });
});

describe('KPI period comparison (non-UTC timezone)', () => {
  const tz = 'Asia/Kolkata'; // UTC+5:30, never DST
  // A fixed "now" in March 2026.
  const now = new Date('2026-03-15T08:00:00Z');

  it('previous month is the immediately preceding calendar month, snapped to local edges', () => {
    const cur = resolvePeriod('month', tz, now);
    const prev = previousPeriod('month', cur, tz);
    // Current = March in IST → starts 2026-02-28T18:30Z (1 Mar 00:00 IST).
    expect(cur.start.toISOString()).toBe('2026-02-28T18:30:00.000Z');
    expect(cur.end.toISOString()).toBe('2026-03-31T18:30:00.000Z');
    // Previous = Feb; ends exactly where March starts.
    expect(prev.end.getTime()).toBe(cur.start.getTime());
    expect(prev.start.toISOString()).toBe('2026-01-31T18:30:00.000Z'); // 1 Feb 00:00 IST
  });

  it('a custom range compares against the equal-duration window immediately before it', () => {
    const cur = resolvePeriod('custom', tz, now, '2026-03-01', '2026-03-07'); // 7 local days
    const prev = previousPeriod('custom', cur, tz);
    expect(prev.end.getTime()).toBe(cur.start.getTime());
    expect(cur.end.getTime() - cur.start.getTime()).toBe(prev.end.getTime() - prev.start.getTime());
  });
});
