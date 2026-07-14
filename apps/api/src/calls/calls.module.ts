import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConsentsModule } from '../consents/consents.module';
import { RecordingsModule } from '../recordings/recordings.module';
import { CallsService } from './calls.service';
import { CallsController } from './calls.controller';
import { MockWebhookController } from './mock-webhook.controller';
import { MyOperatorWebhookController } from './myoperator-webhook.controller';
import { ExotelWebhookController } from './exotel-webhook.controller';
import { CallReconcileProcessor } from './call-reconcile.processor';
import { TELEPHONY_RECONCILE_QUEUE } from './call-reconcile.constants';

/**
 * Call management. TelephonyModule (Mock + MyOperator + Exotel behind the
 * swap-able provider) is global; ConsentsModule and RecordingsModule supply the
 * consent gate + recording orchestration. All three provider webhook routes are
 * registered, plus the reconciliation sweep (recovers MISSED webhooks).
 */
@Module({
  imports: [ConsentsModule, RecordingsModule, BullModule.registerQueue({ name: TELEPHONY_RECONCILE_QUEUE })],
  controllers: [CallsController, MockWebhookController, MyOperatorWebhookController, ExotelWebhookController],
  providers: [CallsService, CallReconcileProcessor],
  exports: [CallsService],
})
export class CallsModule {}
