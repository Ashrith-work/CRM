-- AlterTable
ALTER TABLE "CustomerFeatures" ADD COLUMN     "churnBand" TEXT,
ADD COLUMN     "clvBand" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "hasCogs" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "costMinor" INTEGER;


-- ===========================================================================
-- P2.1 deep analytics — four MATERIALIZED VIEWS. Endpoints READ these; they are
-- never recomputed inline. Only paid/fulfilled orders count; refunds subtract.
-- Days are bucketed in the ORG timezone (placedAt is stored UTC).
-- ===========================================================================

-- 1) revenue_daily: net revenue per org per local day.
CREATE MATERIALIZED VIEW revenue_daily AS
SELECT
  o."organizationId" AS organization_id,
  ((o."placedAt" AT TIME ZONE 'UTC') AT TIME ZONE org.timezone)::date AS day,
  SUM(o."totalMinor" - o."refundedMinor")::bigint AS net_revenue_minor,
  COUNT(*)::int AS order_count
FROM "Order" o
JOIN "Organization" org ON org.id = o."organizationId"
WHERE o."deletedAt" IS NULL AND o.status IN ('PAID', 'FULFILLED')
GROUP BY o."organizationId", org.timezone, ((o."placedAt" AT TIME ZONE 'UTC') AT TIME ZONE org.timezone)::date;
CREATE UNIQUE INDEX revenue_daily_org_day_idx ON revenue_daily (organization_id, day);

-- 2) cohort_retention: cohort = first-purchase month; retention % per period
--    (period 0 = acquisition month). Monthly granularity, cohort-relative.
CREATE MATERIALIZED VIEW cohort_retention AS
WITH months AS (
  SELECT o."organizationId" AS org_id, o."customerId" AS customer_id,
    date_trunc('month', (o."placedAt" AT TIME ZONE 'UTC') AT TIME ZONE org.timezone)::date AS order_month
  FROM "Order" o JOIN "Organization" org ON org.id = o."organizationId"
  WHERE o."customerId" IS NOT NULL AND o."deletedAt" IS NULL AND o.status IN ('PAID', 'FULFILLED')
),
first_order AS (
  SELECT org_id, customer_id, MIN(order_month) AS cohort_month FROM months GROUP BY org_id, customer_id
),
activity AS (
  SELECT f.org_id, f.cohort_month, m.customer_id,
    (EXTRACT(YEAR FROM age(m.order_month, f.cohort_month)) * 12 + EXTRACT(MONTH FROM age(m.order_month, f.cohort_month)))::int AS period_number
  FROM months m JOIN first_order f ON f.org_id = m.org_id AND f.customer_id = m.customer_id
),
cohort_size AS (
  SELECT org_id, cohort_month, COUNT(DISTINCT customer_id)::int AS cohort_size FROM first_order GROUP BY org_id, cohort_month
),
active AS (
  SELECT org_id, cohort_month, period_number, COUNT(DISTINCT customer_id)::int AS active_customers
  FROM activity GROUP BY org_id, cohort_month, period_number
)
SELECT a.org_id AS organization_id, a.cohort_month, a.period_number, cs.cohort_size, a.active_customers,
  ROUND(a.active_customers::numeric / cs.cohort_size * 100, 2) AS retention_pct
FROM active a JOIN cohort_size cs ON cs.org_id = a.org_id AND cs.cohort_month = a.cohort_month;
CREATE UNIQUE INDEX cohort_retention_idx ON cohort_retention (organization_id, cohort_month, period_number);

-- 3) customer_clv: MVP CLV = historical net revenue; banded High/Mid/Low (tertiles).
CREATE MATERIALIZED VIEW customer_clv AS
WITH base AS (
  SELECT o."organizationId" AS organization_id, o."customerId" AS customer_id,
    SUM(o."totalMinor" - o."refundedMinor")::bigint AS clv_minor
  FROM "Order" o
  WHERE o."customerId" IS NOT NULL AND o."deletedAt" IS NULL AND o.status IN ('PAID', 'FULFILLED')
  GROUP BY o."organizationId", o."customerId"
)
SELECT customer_id, organization_id, clv_minor,
  CASE NTILE(3) OVER (PARTITION BY organization_id ORDER BY clv_minor ASC, customer_id ASC)
    WHEN 3 THEN 'High' WHEN 2 THEN 'Mid' ELSE 'Low' END AS clv_band
FROM base;
CREATE UNIQUE INDEX customer_clv_customer_id_idx ON customer_clv (customer_id);
CREATE INDEX customer_clv_org_idx ON customer_clv (organization_id);

-- 4) contribution_margin: per org per local day. margin excludes COGS unless the
--    org hasCogs (is_estimate=true otherwise). net_revenue is already discount-
--    and return-adjusted (total is post-discount; refunds subtracted).
CREATE MATERIALIZED VIEW contribution_margin AS
WITH order_cogs AS (
  SELECT oi."orderId" AS order_id, SUM(oi.quantity * COALESCE(p."costMinor", 0))::bigint AS cogs_minor
  FROM "OrderItem" oi LEFT JOIN "Product" p ON p.id = oi."productId"
  GROUP BY oi."orderId"
),
daily AS (
  SELECT o."organizationId" AS organization_id, org.timezone AS tz, org."hasCogs" AS has_cogs,
    ((o."placedAt" AT TIME ZONE 'UTC') AT TIME ZONE org.timezone)::date AS day,
    SUM(o."totalMinor" - o."refundedMinor")::bigint AS net_revenue_minor,
    SUM(o."refundedMinor")::bigint AS returns_minor,
    SUM(o."discountMinor")::bigint AS discount_minor,
    SUM(COALESCE(oc.cogs_minor, 0))::bigint AS cogs_minor
  FROM "Order" o
  JOIN "Organization" org ON org.id = o."organizationId"
  LEFT JOIN order_cogs oc ON oc.order_id = o.id
  WHERE o."deletedAt" IS NULL AND o.status IN ('PAID', 'FULFILLED')
  GROUP BY o."organizationId", org.timezone, org."hasCogs", ((o."placedAt" AT TIME ZONE 'UTC') AT TIME ZONE org.timezone)::date
)
SELECT organization_id, day, net_revenue_minor, returns_minor, discount_minor, cogs_minor,
  CASE WHEN has_cogs THEN net_revenue_minor - cogs_minor ELSE net_revenue_minor END AS margin_minor,
  (NOT has_cogs) AS is_estimate
FROM daily;
CREATE UNIQUE INDEX contribution_margin_org_day_idx ON contribution_margin (organization_id, day);
