import { Module } from '@nestjs/common';
import { ConsentsModule } from '../consents/consents.module';
import { RecordingsModule } from '../recordings/recordings.module';
import { CallsService } from './calls.service';
import { CallsController } from './calls.controller';
import { MyOperatorWebhookController } from './myoperator-webhook.controller';

/**
 * Call management. TelephonyModule (MyOperator) is global; ConsentsModule and
 * RecordingsModule supply the consent gate + recording orchestration.
 */
@Module({
  imports: [ConsentsModule, RecordingsModule],
  controllers: [CallsController, MyOperatorWebhookController],
  providers: [CallsService],
  exports: [CallsService],
})
export class CallsModule {}
