-- CreateEnum
CREATE TYPE "CallDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('RINGING', 'IN_PROGRESS', 'COMPLETED', 'MISSED', 'FAILED', 'NO_ANSWER');

-- CreateEnum
CREATE TYPE "RecordingStatus" AS ENUM ('NONE', 'PENDING', 'STORED', 'BLOCKED', 'FAILED');

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('CALL_RECORDING');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('GRANTED', 'WITHDRAWN', 'NOT_CAPTURED');

-- CreateEnum
CREATE TYPE "ConsentSource" AS ENUM ('IVR_DISCLOSURE', 'EXPLICIT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityEventType" ADD VALUE 'CALL_LOGGED';
ALTER TYPE "ActivityEventType" ADD VALUE 'CALL_COMPLETED';
ALTER TYPE "ActivityEventType" ADD VALUE 'CALL_MISSED';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "myoperatorCompanyId" TEXT;

-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "direction" "CallDirection" NOT NULL,
    "fromNumber" TEXT NOT NULL,
    "toNumber" TEXT NOT NULL,
    "agentUserId" TEXT,
    "contactId" TEXT,
    "dealId" TEXT,
    "status" "CallStatus" NOT NULL DEFAULT 'RINGING',
    "startedAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "disposition" TEXT,
    "notes" TEXT,
    "externalCallId" TEXT,
    "ambiguousMatch" BOOLEAN NOT NULL DEFAULT false,
    "recordingSourceUrl" TEXT,
    "recordingStoredUrl" TEXT,
    "recordingStatus" "RecordingStatus" NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL DEFAULT 'CALL_RECORDING',
    "status" "ConsentStatus" NOT NULL DEFAULT 'NOT_CAPTURED',
    "source" "ConsentSource",
    "grantedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Call_organizationId_deletedAt_idx" ON "Call"("organizationId", "deletedAt");

-- CreateIndex
CREATE INDEX "Call_organizationId_contactId_startedAt_idx" ON "Call"("organizationId", "contactId", "startedAt");

-- CreateIndex
CREATE INDEX "Call_organizationId_agentUserId_startedAt_idx" ON "Call"("organizationId", "agentUserId", "startedAt");

-- CreateIndex
CREATE INDEX "Call_organizationId_direction_startedAt_idx" ON "Call"("organizationId", "direction", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Call_organizationId_externalCallId_key" ON "Call"("organizationId", "externalCallId");

-- CreateIndex
CREATE INDEX "Consent_organizationId_contactId_idx" ON "Consent"("organizationId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "Consent_organizationId_contactId_purpose_key" ON "Consent"("organizationId", "contactId", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_myoperatorCompanyId_key" ON "Organization"("myoperatorCompanyId");

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

