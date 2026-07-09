-- Loyalty ledger (append-only) + threshold incentive engine.

-- CreateEnum
CREATE TYPE "LoyaltyReason" AS ENUM ('EARN', 'BURN', 'CLAWBACK', 'ADJUST');
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'FIXED_AMOUNT');
CREATE TYPE "IncentiveStatus" AS ENUM ('ACTIVE', 'REDEEMED', 'EXPIRED');

-- Append-only loyalty ledger. Balance = SUM(delta); rows are never edited.
CREATE TABLE "LoyaltyTransaction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" "LoyaltyReason" NOT NULL,
    "refOrderId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoyaltyTransaction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LoyaltyTransaction_organizationId_customerId_createdAt_idx" ON "LoyaltyTransaction" ("organizationId", "customerId", "createdAt");
CREATE INDEX "LoyaltyTransaction_organizationId_refOrderId_idx" ON "LoyaltyTransaction" ("organizationId", "refOrderId");

-- Threshold incentive: capped value, SKU exclusion, min-order, validity, redemption.
CREATE TABLE "Incentive" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "triggerRule" JSONB NOT NULL,
    "discountType" "DiscountType" NOT NULL DEFAULT 'FIXED_AMOUNT',
    "discountValueMinor" INTEGER,
    "discountPercent" INTEGER,
    "maxValueMinor" INTEGER NOT NULL,
    "minNextOrderMinor" INTEGER NOT NULL DEFAULT 0,
    "excludedSkuRule" JSONB,
    "pointsCost" INTEGER NOT NULL DEFAULT 0,
    "marginGuard" BOOLEAN NOT NULL DEFAULT true,
    "discountCode" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "status" "IncentiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "sourceOrderId" TEXT,
    "redeemedOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Incentive_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Incentive_organizationId_customerId_idx" ON "Incentive" ("organizationId", "customerId");
CREATE INDEX "Incentive_organizationId_status_validUntil_idx" ON "Incentive" ("organizationId", "status", "validUntil");
CREATE INDEX "Incentive_organizationId_discountCode_idx" ON "Incentive" ("organizationId", "discountCode");

-- Foreign keys.
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Incentive" ADD CONSTRAINT "Incentive_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
