-- CreateEnum
CREATE TYPE "CampaignType" AS ENUM ('ABANDONED_CART');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('EMAIL');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'CONVERTED', 'HALTED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "CampaignSendStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'BOUNCED', 'BLOCKED', 'FAILED', 'DELAYED');

-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('UNSUBSCRIBE', 'BOUNCE', 'COMPLAINT', 'MANUAL');

-- AlterEnum
ALTER TYPE "ConsentPurpose" ADD VALUE 'MARKETING';

-- AlterEnum
ALTER TYPE "ConsentSource" ADD VALUE 'SHOPIFY';

-- AlterTable
ALTER TABLE "Consent" ADD COLUMN     "customerId" TEXT,
ALTER COLUMN "contactId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "channel" "MessageChannel" NOT NULL DEFAULT 'EMAIL',
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CampaignType" NOT NULL DEFAULT 'ABANDONED_CART',
    "status" "CampaignStatus" NOT NULL DEFAULT 'ACTIVE',
    "channel" "MessageChannel" NOT NULL DEFAULT 'EMAIL',
    "attributionWindowMinutes" INTEGER NOT NULL DEFAULT 10080,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignStep" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "delayMinutes" INTEGER NOT NULL,
    "templateId" TEXT NOT NULL,

    CONSTRAINT "CampaignStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignEnrollment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "checkoutStartedAt" TIMESTAMP(3) NOT NULL,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "convertedOrderId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "haltedAt" TIMESTAMP(3),
    "haltReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignSend" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "campaignStepId" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL DEFAULT 'EMAIL',
    "templateVersion" INTEGER NOT NULL,
    "status" "CampaignSendStatus" NOT NULL DEFAULT 'QUEUED',
    "providerMessageId" TEXT,
    "blockedReason" TEXT,
    "sentAt" TIMESTAMP(3),
    "outcomeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suppression" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" "SuppressionReason" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_organizationId_key_version_key" ON "MessageTemplate"("organizationId", "key", "version");

-- CreateIndex
CREATE INDEX "Campaign_organizationId_type_status_idx" ON "Campaign"("organizationId", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignStep_campaignId_stepOrder_key" ON "CampaignStep"("campaignId", "stepOrder");

-- CreateIndex
CREATE INDEX "CampaignEnrollment_organizationId_status_idx" ON "CampaignEnrollment"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignEnrollment_campaignId_cartId_key" ON "CampaignEnrollment"("campaignId", "cartId");

-- CreateIndex
CREATE INDEX "CampaignSend_organizationId_status_idx" ON "CampaignSend"("organizationId", "status");

-- CreateIndex
CREATE INDEX "CampaignSend_providerMessageId_idx" ON "CampaignSend"("providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignSend_enrollmentId_campaignStepId_key" ON "CampaignSend"("enrollmentId", "campaignStepId");

-- CreateIndex
CREATE INDEX "Suppression_organizationId_email_idx" ON "Suppression"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Suppression_organizationId_email_key" ON "Suppression"("organizationId", "email");

-- CreateIndex
CREATE INDEX "Consent_organizationId_customerId_purpose_idx" ON "Consent"("organizationId", "customerId", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "Consent_organizationId_customerId_purpose_key" ON "Consent"("organizationId", "customerId", "purpose");

-- AddForeignKey
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignStep" ADD CONSTRAINT "CampaignStep_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignStep" ADD CONSTRAINT "CampaignStep_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MessageTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignEnrollment" ADD CONSTRAINT "CampaignEnrollment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignEnrollment" ADD CONSTRAINT "CampaignEnrollment_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSend" ADD CONSTRAINT "CampaignSend_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSend" ADD CONSTRAINT "CampaignSend_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "CampaignEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSend" ADD CONSTRAINT "CampaignSend_campaignStepId_fkey" FOREIGN KEY ("campaignStepId") REFERENCES "CampaignStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suppression" ADD CONSTRAINT "Suppression_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

