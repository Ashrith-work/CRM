import { Module } from '@nestjs/common';
import { LoyaltyService } from './loyalty.service';
import { LoyaltyController } from './loyalty.controller';

/**
 * Append-only loyalty ledger. Exported so M1 ingestion can reconcile earned
 * points on order/refund without duplicating the ledger math.
 */
@Module({
  controllers: [LoyaltyController],
  providers: [LoyaltyService],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
