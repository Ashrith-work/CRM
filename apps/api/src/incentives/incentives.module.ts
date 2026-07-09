import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { ResendAdapter } from '../messaging/resend.adapter';
import { IncentiveController } from './incentive.controller';
import { IncentiveService } from './incentive.service';
import { ShopifyDiscountService } from './shopify-discount.service';
import { IncentiveProcessor } from './incentive.processor';
import { INCENTIVE_QUEUE } from './incentive.constants';

/**
 * Threshold incentive engine. Reuses M4's ConsentGate (via CampaignsModule) for
 * gated reward notifications and the loyalty ledger for points-cost burns.
 * Exported so M1 ingestion can drive onOrder/onRefund.
 */
@Module({
  imports: [CampaignsModule, LoyaltyModule, BullModule.registerQueue({ name: INCENTIVE_QUEUE })],
  controllers: [IncentiveController],
  providers: [IncentiveService, ShopifyDiscountService, ResendAdapter, IncentiveProcessor],
  exports: [IncentiveService],
})
export class IncentivesModule {}
