import { Module } from '@nestjs/common';
import { ConsentsModule } from '../consents/consents.module';
import { RecordingsModule } from '../recordings/recordings.module';
import { CallsService } from './calls.service';
import { CallsController } from './calls.controller';
import { MyOperatorWebhookController } from './myoperator-webhook.controller';
import { ExotelWebhookController } from './exotel-webhook.controller';

/**
 * Call management. TelephonyModule (MyOperator + Exotel behind the swap-able
 * provider) is global; ConsentsModule and RecordingsModule supply the consent
 * gate + recording orchestration. Both provider webhook routes are registered.
 */
@Module({
  imports: [ConsentsModule, RecordingsModule],
  controllers: [CallsController, MyOperatorWebhookController, ExotelWebhookController],
  providers: [CallsService],
  exports: [CallsService],
})
export class CallsModule {}
