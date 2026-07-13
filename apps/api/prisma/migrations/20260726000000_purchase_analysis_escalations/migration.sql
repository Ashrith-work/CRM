-- Purchase Analysis Dashboard: product tags (for the "Fabrics" field) + the one
-- new dataset, EscalationSummary (human escalation notes; Shopify has none).

-- Product tags (Shopify product tags; read for "Fabrics", never fabricated).
ALTER TABLE "Product" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Escalation status.
CREATE TYPE "EscalationStatus" AS ENUM ('OPEN', 'RESOLVED');

-- EscalationSummary.
CREATE TABLE "EscalationSummary" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT,
    "note" TEXT NOT NULL,
    "status" "EscalationStatus",
    "authorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EscalationSummary_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EscalationSummary_organizationId_customerId_createdAt_idx"
    ON "EscalationSummary" ("organizationId", "customerId", "createdAt");

ALTER TABLE "EscalationSummary"
    ADD CONSTRAINT "EscalationSummary_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
