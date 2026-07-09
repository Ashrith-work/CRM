-- First-touch source on orders + VIP tier on customer features.

-- Denormalized first-touch source (from cart attributes) for order-level coverage.
ALTER TABLE "Order" ADD COLUMN "firstTouchSource" TEXT;

-- VIP tier assigned by the tier worker (CLV, or spend fallback).
ALTER TABLE "CustomerFeatures" ADD COLUMN "vipTier" TEXT;

-- Backfill firstTouchSource for existing orders from their captured cart-attribute
-- UTMs. Meta-family sources collapse to 'meta' (matching the attribution engine);
-- everything else keeps its utm_source lowercased; absent → 'unknown'.
UPDATE "Order" SET "firstTouchSource" =
  CASE
    WHEN lower("attributes"->'utm'->>'source') IN ('facebook','fb','meta','instagram','ig','fb_ig','facebook_instagram') THEN 'meta'
    WHEN "attributes"->'utm'->>'source' IS NOT NULL AND btrim("attributes"->'utm'->>'source') <> '' THEN lower("attributes"->'utm'->>'source')
    ELSE 'unknown'
  END
WHERE "firstTouchSource" IS NULL;

-- Index for order-level coverage aggregation.
CREATE INDEX "Order_organizationId_firstTouchSource_idx" ON "Order" ("organizationId", "firstTouchSource");
