import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConsentsModule } from '../consents/consents.module';
import { CloudinaryService } from './cloudinary.service';
import { RecordingsService } from './recordings.service';
import { FetchRecordingProcessor } from './fetch-recording.processor';
import { RECORDING_FETCH_QUEUE } from './recording.constants';

/**
 * Recording storage: Cloudinary adapter, the async fetch/purge worker, and the
 * RecordingsService seam. Depends on ConsentsModule for the gate; TelephonyModule
 * (global) supplies the MyOperator download.
 */
@Module({
  imports: [ConsentsModule, BullModule.registerQueue({ name: RECORDING_FETCH_QUEUE })],
  providers: [CloudinaryService, RecordingsService, FetchRecordingProcessor],
  exports: [RecordingsService, CloudinaryService],
})
export class RecordingsModule {}
