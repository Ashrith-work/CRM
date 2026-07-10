-- Recovery-lead assignment: prospect ownership + progress log + assignment history.
-- Additive only. (The glossary_embedding pgvector table is intentionally left
-- untouched — it is managed by raw SQL in the p22 migration, not a Prisma model.)

-- CreateEnum
CREATE TYPE "RecoveryStatus" AS ENUM ('to_contact', 'contacted', 'interested', 'no_response', 'converted', 'lost');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "ownerUserId" TEXT,
ADD COLUMN     "recoveryConvertedAt" TIMESTAMP(3),
ADD COLUMN     "recoveryStatus" "RecoveryStatus";

-- CreateTable
CREATE TABLE "ProgressUpdate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "status" "RecoveryStatus" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgressUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAssignmentHistory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "fromUserId" TEXT,
    "toUserId" TEXT,
    "actorUserId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerAssignmentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProgressUpdate_organizationId_customerId_createdAt_idx" ON "ProgressUpdate"("organizationId", "customerId", "createdAt");

-- CreateIndex
CREATE INDEX "ProgressUpdate_organizationId_authorUserId_createdAt_idx" ON "ProgressUpdate"("organizationId", "authorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerAssignmentHistory_organizationId_customerId_created_idx" ON "CustomerAssignmentHistory"("organizationId", "customerId", "createdAt");

-- CreateIndex
CREATE INDEX "Customer_organizationId_ownerUserId_idx" ON "Customer"("organizationId", "ownerUserId");

-- CreateIndex
CREATE INDEX "Customer_organizationId_recoveryStatus_idx" ON "Customer"("organizationId", "recoveryStatus");

-- AddForeignKey
ALTER TABLE "ProgressUpdate" ADD CONSTRAINT "ProgressUpdate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressUpdate" ADD CONSTRAINT "ProgressUpdate_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAssignmentHistory" ADD CONSTRAINT "CustomerAssignmentHistory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAssignmentHistory" ADD CONSTRAINT "CustomerAssignmentHistory_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
