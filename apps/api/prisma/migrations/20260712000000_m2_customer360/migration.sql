-- CreateEnum
CREATE TYPE "InteractionType" AS ENUM ('ORDER', 'EVENT', 'MESSAGE', 'CALL', 'TICKET', 'NOTE', 'RETURN');

-- CreateTable
CREATE TABLE "Interaction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "InteractionType" NOT NULL,
    "refId" TEXT NOT NULL,
    "summary" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Interaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerFeatures" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "netRevenueMinor" INTEGER NOT NULL DEFAULT 0,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "firstOrderAt" TIMESTAMP(3),
    "lastOrderAt" TIMESTAMP(3),
    "avgOrderValueMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT,
    "rfmScore" TEXT,
    "clvMinor" INTEGER,
    "churnRisk" DOUBLE PRECISION,
    "apparelSize" TEXT,
    "fit" TEXT,
    "styleAffinity" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerFeatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperienceExport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "customerId" TEXT,
    "masked" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExperienceExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Interaction_organizationId_customerId_occurredAt_idx" ON "Interaction"("organizationId", "customerId", "occurredAt");

-- CreateIndex
CREATE INDEX "Interaction_organizationId_customerId_type_occurredAt_idx" ON "Interaction"("organizationId", "customerId", "type", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Interaction_organizationId_type_refId_key" ON "Interaction"("organizationId", "type", "refId");

-- CreateIndex
CREATE INDEX "CustomerFeatures_organizationId_netRevenueMinor_idx" ON "CustomerFeatures"("organizationId", "netRevenueMinor");

-- CreateIndex
CREATE INDEX "CustomerFeatures_organizationId_lastOrderAt_idx" ON "CustomerFeatures"("organizationId", "lastOrderAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerFeatures_organizationId_customerId_key" ON "CustomerFeatures"("organizationId", "customerId");

-- CreateIndex
CREATE INDEX "ExperienceExport_organizationId_createdAt_idx" ON "ExperienceExport"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFeatures" ADD CONSTRAINT "CustomerFeatures_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperienceExport" ADD CONSTRAINT "ExperienceExport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

