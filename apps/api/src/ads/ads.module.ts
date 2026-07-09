import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuditModule } from '../audit/audit.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { AdsController } from './ads.controller';
import { MetaService } from './meta.service';
import { MetaConnectService } from './meta-connect.service';
import { MetaSyncService } from './meta-sync.service';
import { MetaAdsProcessor } from './meta-ads.processor';
import { AttributionController } from '../attribution/attribution.controller';
import { AttributionService } from '../attribution/attribution.service';
import { AttributionRefreshService } from '../attribution/attribution-refresh.service';
import { AudienceController } from '../audiences/audience.controller';
import { AudienceService } from '../audiences/audience.service';
import { ADS_QUEUE } from './ads.constants';

/**
 * P2.3 — Meta ads + first-touch attribution + (ConsentGate-gated) audience sync.
 * Reuses M4's MarketingConsentGate (via CampaignsModule) so audience uploads go
 * through the SAME consent+suppression gate as marketing sends.
 */
@Module({
  imports: [AuditModule, CampaignsModule, BullModule.registerQueue({ name: ADS_QUEUE })],
  controllers: [AdsController, AttributionController, AudienceController],
  providers: [
    MetaService,
    MetaConnectService,
    MetaSyncService,
    AttributionService,
    AttributionRefreshService,
    AudienceService,
    MetaAdsProcessor,
  ],
})
export class AdsModule {}
