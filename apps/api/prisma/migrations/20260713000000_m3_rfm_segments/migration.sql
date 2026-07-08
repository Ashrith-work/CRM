-- CreateEnum
CREATE TYPE "SegmentType" AS ENUM ('STATIC', 'DYNAMIC');

-- AlterTable
ALTER TABLE "CustomerFeatures" ADD COLUMN     "daysSinceLast" INTEGER,
ADD COLUMN     "fScore" INTEGER,
ADD COLUMN     "mScore" INTEGER,
ADD COLUMN     "rScore" INTEGER,
ADD COLUMN     "rSegment" TEXT;

-- CreateTable
CREATE TABLE "Segment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rules" JSONB NOT NULL,
    "type" "SegmentType" NOT NULL DEFAULT 'STATIC',
    "refreshCron" TEXT,
    "createdById" TEXT NOT NULL,
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "lastRefreshedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SegmentMembership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SegmentMembership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Segment_organizationId_deletedAt_idx" ON "Segment"("organizationId", "deletedAt");

-- CreateIndex
CREATE INDEX "SegmentMembership_organizationId_segmentId_idx" ON "SegmentMembership"("organizationId", "segmentId");

-- CreateIndex
CREATE UNIQUE INDEX "SegmentMembership_segmentId_customerId_key" ON "SegmentMembership"("segmentId", "customerId");

-- CreateIndex
CREATE INDEX "CustomerFeatures_organizationId_rSegment_idx" ON "CustomerFeatures"("organizationId", "rSegment");

-- AddForeignKey
ALTER TABLE "Segment" ADD CONSTRAINT "Segment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SegmentMembership" ADD CONSTRAINT "SegmentMembership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SegmentMembership" ADD CONSTRAINT "SegmentMembership_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- customer_rfm MATERIALIZED VIEW (raw SQL — analytics live in views; endpoints
-- read it, never recompute inline). Only paid/fulfilled orders count; refunds
-- subtract from monetary. NTILE(5) ordered so most-recent recency = 5, with a
-- deterministic customer_id tiebreak at quintile boundaries.
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW customer_rfm AS
WITH base AS (
  SELECT
    o."organizationId" AS organization_id,
    o."customerId"     AS customer_id,
    MAX(o."placedAt")  AS last_order_at,
    COUNT(*)::int      AS frequency,
    SUM(o."totalMinor" - o."refundedMinor")::bigint AS monetary_minor
  FROM "Order" o
  WHERE o."customerId" IS NOT NULL
    AND o."deletedAt" IS NULL
    AND o.status IN ('PAID', 'FULFILLED')
  GROUP BY o."organizationId", o."customerId"
)
SELECT
  customer_id,
  organization_id,
  last_order_at,
  frequency,
  monetary_minor,
  NTILE(5) OVER (PARTITION BY organization_id ORDER BY last_order_at ASC, customer_id ASC)  AS r_score,
  NTILE(5) OVER (PARTITION BY organization_id ORDER BY frequency ASC, customer_id ASC)      AS f_score,
  NTILE(5) OVER (PARTITION BY organization_id ORDER BY monetary_minor ASC, customer_id ASC) AS m_score
FROM base;

CREATE UNIQUE INDEX customer_rfm_customer_id_idx ON customer_rfm (customer_id);
CREATE INDEX customer_rfm_org_idx ON customer_rfm (organization_id);
