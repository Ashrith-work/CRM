import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConsentService } from './consent.service';
import { ConsentGate } from './consent-gate.service';
import { ConsentsController } from './consents.controller';
import { RECORDING_FETCH_QUEUE } from '../recordings/recording.constants';

/**
 * DPDP consent + the ConsentGate. Registers the recording queue so withdrawal
 * can enqueue a purge (the worker lives in RecordingsModule; a shared queue name
 * avoids a module cycle). Exports both services for calls + recordings.
 */
@Module({
  imports: [BullModule.registerQueue({ name: RECORDING_FETCH_QUEUE })],
  controllers: [ConsentsController],
  providers: [ConsentService, ConsentGate],
  exports: [ConsentService, ConsentGate],
})
export class ConsentsModule {}
