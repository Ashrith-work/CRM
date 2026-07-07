import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { RecordingUrlResponse } from '@crm/types';
import type { Call as CallRow } from '@prisma/client';
import type { Env } from '../config/env';
import { ConsentGate } from '../consents/consent-gate.service';
import { CloudinaryService } from './cloudinary.service';
import { RECORDING_FETCH_QUEUE, type FetchRecordingJob } from './recording.constants';

/**
 * Recording orchestration seam used by the calls module: enqueue the async
 * fetch, and mint a consent-gated signed playback URL.
 */
@Injectable()
export class RecordingsService {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly cloudinary: CloudinaryService,
    private readonly gate: ConsentGate,
    @InjectQueue(RECORDING_FETCH_QUEUE) private readonly queue: Queue,
  ) {}

  /** Enqueue an idempotent fetch-and-store job for a completed call. */
  async enqueueFetch(callId: string): Promise<void> {
    await this.queue.add(
      'fetch',
      { type: 'fetch', callId } satisfies FetchRecordingJob,
      { jobId: `fetch_${callId}`, attempts: 5, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: true, removeOnFail: 500 },
    );
  }

  /**
   * A short-lived signed playback URL — but only when the recording is STORED
   * AND consent is still GRANTED (re-checked at serve time). Otherwise returns
   * a null url with a reason (and the gate audits a blocked serve).
   */
  async getSignedUrl(call: CallRow, actorUserId: string): Promise<RecordingUrlResponse> {
    if (call.recordingStatus !== 'STORED' || !call.recordingStoredUrl) {
      return {
        status: call.recordingStatus,
        url: null,
        expiresAt: null,
        reason: call.recordingStatus === 'BLOCKED' ? 'blocked — no recording consent' : 'no stored recording',
      };
    }
    const allowed = await this.gate.ensureCanStore(call.organizationId, call.contactId, call.id, actorUserId);
    if (!allowed) {
      return { status: 'BLOCKED', url: null, expiresAt: null, reason: 'consent not granted' };
    }
    const ttl = this.config.get('RECORDING_URL_TTL_SECONDS', { infer: true });
    const { url, expiresAt } = this.cloudinary.signedUrl(call.recordingStoredUrl, ttl);
    return { status: 'STORED', url, expiresAt: expiresAt.toISOString(), reason: null };
  }
}
