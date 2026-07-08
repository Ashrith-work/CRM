-- DropForeignKey
ALTER TABLE "CampaignSend" DROP CONSTRAINT "CampaignSend_campaignStepId_fkey";

-- DropForeignKey
ALTER TABLE "CampaignStep" DROP CONSTRAINT "CampaignStep_templateId_fkey";

-- AddForeignKey
ALTER TABLE "CampaignStep" ADD CONSTRAINT "CampaignStep_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MessageTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSend" ADD CONSTRAINT "CampaignSend_campaignStepId_fkey" FOREIGN KEY ("campaignStepId") REFERENCES "CampaignStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

