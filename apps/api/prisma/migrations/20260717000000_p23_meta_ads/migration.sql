-- P2.3 — Meta ads + first-touch attribution + audience sync.

-- CreateEnum
CREATE TYPE "AdEntityType" AS ENUM ('campaign', 'adset', 'ad', 'creative');
CREATE TYPE "AdLeadStatus" AS ENUM ('NEW', 'CONVERTED');
CREATE TYPE "AudienceType" AS ENUM ('custom', 'suppression');

-- AlterTable — first-touch UTM/referrer ride-along (from Shopify cart attributes).
ALTER TABLE "Order" ADD COLUMN "attributes" JSONB;
ALTER TABLE "Cart"  ADD COLUMN "attributes" JSONB;

-- CreateTable: Meta hierarchy.
CREATE TABLE "AdAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdAccount_organizationId_externalId_key" ON "AdAccount" ("organizationId", "externalId");
CREATE INDEX "AdAccount_organizationId_idx" ON "AdAccount" ("organizationId");

CREATE TABLE "AdCampaign" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "accountExternalId" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT,
    "objective" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdCampaign_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdCampaign_organizationId_externalId_key" ON "AdCampaign" ("organizationId", "externalId");
CREATE INDEX "AdCampaign_organizationId_idx" ON "AdCampaign" ("organizationId");

CREATE TABLE "AdSet" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "campaignExternalId" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdSet_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdSet_organizationId_externalId_key" ON "AdSet" ("organizationId", "externalId");
CREATE INDEX "AdSet_organizationId_idx" ON "AdSet" ("organizationId");

CREATE TABLE "Ad" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "adsetExternalId" TEXT,
    "creativeExternalId" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Ad_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Ad_organizationId_externalId_key" ON "Ad" ("organizationId", "externalId");
CREATE INDEX "Ad_organizationId_idx" ON "Ad" ("organizationId");

CREATE TABLE "AdCreative" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdCreative_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdCreative_organizationId_externalId_key" ON "AdCreative" ("organizationId", "externalId");
CREATE INDEX "AdCreative_organizationId_idx" ON "AdCreative" ("organizationId");

-- Daily rollups. UNIQUE(org, entityType, entityId, date) ⇒ re-pull OVERWRITES.
CREATE TABLE "AdMetricDaily" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entityType" "AdEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "spendMinor" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdMetricDaily_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdMetricDaily_organizationId_entityType_entityId_date_key" ON "AdMetricDaily" ("organizationId", "entityType", "entityId", "date");
CREATE INDEX "AdMetricDaily_organizationId_entityType_date_idx" ON "AdMetricDaily" ("organizationId", "entityType", "date");

-- Every touchpoint (Part 9). UNIQUE(org, channel, sessionId) dedups.
CREATE TABLE "Touchpoint" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT,
    "sessionId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "campaign" TEXT,
    "adset" TEXT,
    "creative" TEXT,
    "utm" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Touchpoint_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Touchpoint_organizationId_channel_sessionId_key" ON "Touchpoint" ("organizationId", "channel", "sessionId");
CREATE INDEX "Touchpoint_organizationId_customerId_occurredAt_idx" ON "Touchpoint" ("organizationId", "customerId", "occurredAt");
CREATE INDEX "Touchpoint_organizationId_source_idx" ON "Touchpoint" ("organizationId", "source");

CREATE TABLE "AdLead" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "formId" TEXT,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "source" TEXT NOT NULL DEFAULT 'meta',
    "campaign" TEXT,
    "adset" TEXT,
    "ad" TEXT,
    "firstTouchTouchpointId" TEXT,
    "status" "AdLeadStatus" NOT NULL DEFAULT 'NEW',
    "convertedCustomerId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdLead_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdLead_organizationId_externalId_key" ON "AdLead" ("organizationId", "externalId");
CREATE INDEX "AdLead_organizationId_email_idx" ON "AdLead" ("organizationId", "email");
CREATE INDEX "AdLead_organizationId_status_idx" ON "AdLead" ("organizationId", "status");

CREATE TABLE "AudienceSync" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "metaAudienceId" TEXT,
    "type" "AudienceType" NOT NULL DEFAULT 'custom',
    "sizeSynced" INTEGER NOT NULL DEFAULT 0,
    "excludedByConsent" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AudienceSync_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AudienceSync_organizationId_segmentId_idx" ON "AudienceSync" ("organizationId", "segmentId");

-- Foreign keys (all cascade on org delete, matching the tenant invariant).
ALTER TABLE "AdAccount"     ADD CONSTRAINT "AdAccount_organizationId_fkey"     FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdCampaign"    ADD CONSTRAINT "AdCampaign_organizationId_fkey"    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdSet"         ADD CONSTRAINT "AdSet_organizationId_fkey"         FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Ad"            ADD CONSTRAINT "Ad_organizationId_fkey"            FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdCreative"    ADD CONSTRAINT "AdCreative_organizationId_fkey"    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdMetricDaily" ADD CONSTRAINT "AdMetricDaily_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Touchpoint"    ADD CONSTRAINT "Touchpoint_organizationId_fkey"    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdLead"        ADD CONSTRAINT "AdLead_organizationId_fkey"        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AudienceSync"  ADD CONSTRAINT "AudienceSync_organizationId_fkey"  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- source_ltv_cac — per FIRST-TOUCH source: customers acquired, LTV (store-actual
-- net revenue), spend (Meta), CAC, LTV:CAC, and CAC payback (months). Deterministic
-- (no now()) so the golden test can hand-verify it. Money is minor units.
-- ===========================================================================
CREATE MATERIALIZED VIEW source_ltv_cac AS
WITH first_touch AS (
  SELECT DISTINCT ON (t."organizationId", t."customerId")
    t."organizationId" AS organization_id, t."customerId" AS customer_id, t.source
  FROM "Touchpoint" t
  WHERE t."customerId" IS NOT NULL
  ORDER BY t."organizationId", t."customerId", t."occurredAt" ASC, t.id ASC
),
cust_ltv AS (
  SELECT o."organizationId" AS organization_id, o."customerId" AS customer_id,
    SUM(o."totalMinor" - o."refundedMinor")::bigint AS net_minor
  FROM "Order" o
  WHERE o."customerId" IS NOT NULL AND o."deletedAt" IS NULL AND o.status IN ('PAID','FULFILLED')
  GROUP BY o."organizationId", o."customerId"
),
order_months AS (
  SELECT ft.organization_id, ft.source,
    COUNT(DISTINCT date_trunc('month', o."placedAt")) AS active_months
  FROM first_touch ft
  JOIN "Order" o ON o."organizationId" = ft.organization_id AND o."customerId" = ft.customer_id
    AND o."deletedAt" IS NULL AND o.status IN ('PAID','FULFILLED')
  GROUP BY ft.organization_id, ft.source
),
by_source AS (
  SELECT ft.organization_id, ft.source,
    COUNT(DISTINCT ft.customer_id) AS customers_acquired,
    COALESCE(SUM(cl.net_minor), 0)::bigint AS ltv_total_minor
  FROM first_touch ft
  LEFT JOIN cust_ltv cl ON cl.organization_id = ft.organization_id AND cl.customer_id = ft.customer_id
  GROUP BY ft.organization_id, ft.source
),
spend_by_source AS (
  SELECT m."organizationId" AS organization_id, 'meta'::text AS source, SUM(m."spendMinor")::bigint AS spend_minor
  FROM "AdMetricDaily" m
  WHERE m."entityType" = 'campaign'
  GROUP BY m."organizationId"
)
SELECT
  bs.organization_id,
  bs.source,
  bs.customers_acquired,
  bs.ltv_total_minor,
  (CASE WHEN bs.customers_acquired > 0 THEN bs.ltv_total_minor / bs.customers_acquired ELSE 0 END)::bigint AS avg_ltv_minor,
  COALESCE(sp.spend_minor, 0)::bigint AS spend_minor,
  (CASE WHEN bs.customers_acquired > 0 AND COALESCE(sp.spend_minor, 0) > 0
        THEN sp.spend_minor / bs.customers_acquired ELSE NULL END)::bigint AS cac_minor,
  CASE WHEN COALESCE(sp.spend_minor, 0) > 0
       THEN round(bs.ltv_total_minor::numeric / sp.spend_minor, 4) ELSE NULL END AS ltv_cac_ratio,
  COALESCE(om.active_months, 1)::int AS active_months,
  CASE WHEN COALESCE(sp.spend_minor, 0) > 0 AND bs.ltv_total_minor > 0
       THEN round((sp.spend_minor::numeric * GREATEST(COALESCE(om.active_months, 1), 1)) / bs.ltv_total_minor, 2)
       ELSE NULL END AS payback_months
FROM by_source bs
LEFT JOIN spend_by_source sp ON sp.organization_id = bs.organization_id AND sp.source = bs.source
LEFT JOIN order_months om ON om.organization_id = bs.organization_id AND om.source = bs.source;
CREATE UNIQUE INDEX source_ltv_cac_org_source_idx ON source_ltv_cac (organization_id, source);

-- ===========================================================================
-- ad_performance — per-entity spend/impressions/clicks/conversions rollups + CTR
-- and CPC. Conversions are Meta-REPORTED (over-report); revenue/ROAS is at the
-- source level in source_ltv_cac (store-actual). Names resolve via a table join.
-- ===========================================================================
CREATE MATERIALIZED VIEW ad_performance AS
SELECT
  m."organizationId" AS organization_id,
  m."entityType"::text AS entity_type,
  m."entityId" AS entity_id,
  SUM(m."spendMinor")::bigint AS spend_minor,
  SUM(m.impressions)::bigint AS impressions,
  SUM(m.clicks)::bigint AS clicks,
  SUM(m.conversions)::bigint AS conversions,
  CASE WHEN SUM(m.impressions) > 0 THEN round(SUM(m.clicks)::numeric / SUM(m.impressions), 4) ELSE 0 END AS ctr,
  (CASE WHEN SUM(m.clicks) > 0 THEN SUM(m."spendMinor") / SUM(m.clicks) ELSE 0 END)::bigint AS cpc_minor
FROM "AdMetricDaily" m
GROUP BY m."organizationId", m."entityType", m."entityId";
CREATE UNIQUE INDEX ad_performance_pk_idx ON ad_performance (organization_id, entity_type, entity_id);
