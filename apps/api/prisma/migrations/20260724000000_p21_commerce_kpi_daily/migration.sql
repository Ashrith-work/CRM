-- ===========================================================================
-- P2.1 dashboard KPIs — one daily commerce rollup the KPI endpoint sums over any
-- period (and the previous period). Same conventions as revenue_daily: only
-- paid/fulfilled orders count, refunds subtract, days bucketed in the ORG
-- timezone (placedAt is stored UTC). Endpoints READ this; never recompute inline.
--
-- Columns (per org, per local day):
--   net_minor            SUM(total - refunded)         — net revenue
--   gross_minor          SUM(total)                    — gross (pre-refund) revenue
--   refunded_minor       SUM(refunded)                 — refund value
--   discount_minor       SUM(discount)                 — discount value given
--   order_count          COUNT(*)                      — orders
--   refund_order_count   COUNT(*) with refunded > 0    — orders that had a refund
--   discount_order_count COUNT(*) with a discount code — orders that used a code
--   new_customer_count   customers whose FIRST order day = this day
-- ===========================================================================
CREATE MATERIALIZED VIEW commerce_kpi_daily AS
WITH ord AS (
  SELECT
    o."organizationId" AS organization_id,
    o."customerId"     AS customer_id,
    o."totalMinor"     AS total_minor,
    o."refundedMinor"  AS refunded_minor,
    o."discountMinor"  AS discount_minor,
    o."discountCode"   AS discount_code,
    ((o."placedAt" AT TIME ZONE 'UTC') AT TIME ZONE org.timezone)::date AS day
  FROM "Order" o
  JOIN "Organization" org ON org.id = o."organizationId"
  WHERE o."deletedAt" IS NULL AND o.status IN ('PAID', 'FULFILLED')
),
first_order AS (
  SELECT organization_id, customer_id, MIN(day) AS first_day
  FROM ord
  WHERE customer_id IS NOT NULL
  GROUP BY organization_id, customer_id
),
new_by_day AS (
  SELECT organization_id, first_day AS day, COUNT(*)::int AS new_customer_count
  FROM first_order
  GROUP BY organization_id, first_day
)
SELECT
  ord.organization_id,
  ord.day,
  SUM(ord.total_minor - ord.refunded_minor)::bigint AS net_minor,
  SUM(ord.total_minor)::bigint                       AS gross_minor,
  SUM(ord.refunded_minor)::bigint                    AS refunded_minor,
  SUM(ord.discount_minor)::bigint                    AS discount_minor,
  COUNT(*)::int                                      AS order_count,
  COUNT(*) FILTER (WHERE ord.refunded_minor > 0)::int    AS refund_order_count,
  COUNT(*) FILTER (WHERE ord.discount_code IS NOT NULL)::int AS discount_order_count,
  COALESCE(nbd.new_customer_count, 0)::int           AS new_customer_count
FROM ord
LEFT JOIN new_by_day nbd
  ON nbd.organization_id = ord.organization_id AND nbd.day = ord.day
GROUP BY ord.organization_id, ord.day, nbd.new_customer_count;

-- Unique index → enables REFRESH MATERIALIZED VIEW CONCURRENTLY + fast period reads.
CREATE UNIQUE INDEX commerce_kpi_daily_org_day_idx ON commerce_kpi_daily (organization_id, day);
