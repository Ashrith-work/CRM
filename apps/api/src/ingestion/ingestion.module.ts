import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CustomersModule } from '../customers/customers.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { IncentivesModule } from '../incentives/incentives.module';
import { ShopifyService } from './shopify.service';
import { CommerceIngestService } from './commerce-ingest.service';
import { MarketingConsentWriter } from './marketing-consent.writer';
import { IngestionService } from './ingestion.service';
import { IngestionController } from './ingestion.controller';
import { ShopifyWebhookController } from './shopify-webhook.controller';
import { SyncProcessor } from './sync.processor';
import { SHOPIFY_SYNC_QUEUE } from './commerce.constants';

/**
 * Shopify ingestion: connection + webhook + the BullMQ sync worker (backfill /
 * reconcile / webhook). Depends on CustomersModule (IdentityService) for the
 * shared upsert path.
 */
@Module({
  imports: [CustomersModule, LoyaltyModule, IncentivesModule, BullModule.registerQueue({ name: SHOPIFY_SYNC_QUEUE })],
  controllers: [IngestionController, ShopifyWebhookController],
  providers: [ShopifyService, CommerceIngestService, IngestionService, SyncProcessor, MarketingConsentWriter],
  exports: [IngestionService],
})
export class IngestionModule {}
