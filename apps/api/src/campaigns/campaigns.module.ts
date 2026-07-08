import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuditModule } from '../audit/audit.module';
import { CampaignsController } from './campaigns.controller';
import { ResendWebhookController } from './resend-webhook.controller';
import { CampaignService } from './campaign.service';
import { CampaignEngine } from './campaign-engine.service';
import { MarketingConsentGate } from './marketing-consent-gate.service';
import { ResendWebhookService } from './resend-webhook.service';
import { ResendAdapter } from '../messaging/resend.adapter';
import { CampaignProcessor } from './campaign.processor';
import { CAMPAIGN_QUEUE } from './campaign.constants';

/**
 * M4 — abandoned-cart recovery (the closed loop / MVP ship line). Consent-gated
 * email sequence that halts on purchase + the recovery-rate tile.
 */
@Module({
  imports: [AuditModule, BullModule.registerQueue({ name: CAMPAIGN_QUEUE })],
  controllers: [CampaignsController, ResendWebhookController],
  providers: [CampaignService, CampaignEngine, MarketingConsentGate, ResendWebhookService, ResendAdapter, CampaignProcessor],
  exports: [CampaignEngine, MarketingConsentGate],
})
export class CampaignsModule {}
