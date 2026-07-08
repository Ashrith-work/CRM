import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { MyOperatorService } from '../telephony/myoperator.service';
import { ConsentGate } from '../consents/consent-gate.service';
import type { Env } from '../config/env';
import { CloudinaryService } from './cloudinary.service';
import { RECORDING_FETCH_QUEUE, type RecordingJob } from './recording.constants';

/**
 * Async recording worker:
 *  - "fetch": ConsentGate check → download from MyOperator (size-guarded) →
 *    upload to Cloudinary → set recordingStoredUrl + STORED. Retries with
 *    backoff; marks FAILED (but keeps the Call) after the final attempt.
 *  - "purge": DPDP erasure — destroy every stored recording for a contact.
 */
@Processor(RECORDING_FETCH_QUEUE, { concurrency: 4 })
export class FetchRecordingProcessor extends WorkerHost {
  private readonly logger = new Logger(FetchRecordingProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly myoperator: MyOperatorService,
    private readonly cloudinary: CloudinaryService,
    private readonly gate: ConsentGate,
  ) {
    super();
  }

  async process(job: Job<RecordingJob>): Promise<{ ok: boolean }> {
    if (job.data.type === 'purge') return this.purge(job.data.organizationId, job.data.contactId);
    return this.fetch(job, job.data.callId);
  }

  private async fetch(job: Job<RecordingJob>, callId: string): Promise<{ ok: boolean }> {
    const call = await this.prisma.call.findUnique({ where: { id: callId } });
    if (!call || call.deletedAt) return { ok: false };
    if (call.recordingStatus === 'STORED') return { ok: true };
    if (!call.recordingSourceUrl) return { ok: false };

    // Consent gate — never download without GRANTED consent (audited on block).
    const allowed = await this.gate.ensureCanStore(call.organizationId, call.contactId, call.id, call.agentUserId);
    if (!allowed) {
      await this.prisma.call.update({ where: { id: call.id }, data: { recordingStatus: 'BLOCKED' } });
      return { ok: false };
    }

    try {
      await this.prisma.call.update({ where: { id: call.id }, data: { recordingStatus: 'PENDING' } });
      const download = await this.myoperator.downloadRecording(call.recordingSourceUrl);

      const maxBytes = this.config.get('RECORDING_MAX_BYTES', { infer: true });
      if (download.sizeBytes > maxBytes) {
        await this.prisma.call.update({ where: { id: call.id }, data: { recordingStatus: 'FAILED' } });
        this.logger.warn(`Recording ${call.id} too large (${download.sizeBytes} > ${maxBytes}) — marked FAILED`);
        return { ok: false };
      }

      const stored = await this.cloudinary.upload(download.buffer, call.id);
      await this.prisma.call.update({
        where: { id: call.id },
        data: { recordingStoredUrl: stored.publicId, recordingStatus: 'STORED' },
      });
      this.logger.log(`Stored recording for call ${call.id} (${stored.bytes} bytes)`);
      return { ok: true };
    } catch (err) {
      const maxAttempts = job.opts.attempts ?? 1;
      const isLast = job.attemptsMade + 1 >= maxAttempts;
      this.logger.warn(`Recording fetch for ${call.id} failed (attempt ${job.attemptsMade + 1}/${maxAttempts}): ${(err as Error).message}`);
      if (isLast) {
        await this.prisma.call.update({ where: { id: call.id }, data: { recordingStatus: 'FAILED' } });
        return { ok: false };
      }
      throw err; // let BullMQ retry with backoff
    }
  }

  private async purge(organizationId: string, contactId: string): Promise<{ ok: boolean }> {
    const calls = await this.prisma.call.findMany({
      where: { organizationId, contactId, recordingStatus: 'STORED', recordingStoredUrl: { not: null } },
      select: { id: true, recordingStoredUrl: true },
    });
    for (const c of calls) {
      try {
        if (c.recordingStoredUrl) await this.cloudinary.destroy(c.recordingStoredUrl);
      } catch (err) {
        this.logger.warn(`Purge: destroy failed for call ${c.id}: ${(err as Error).message}`);
      }
      await this.prisma.call.update({
        where: { id: c.id },
        data: { recordingStoredUrl: null, recordingStatus: 'BLOCKED' },
      });
    }
    if (calls.length) this.logger.log(`Purged ${calls.length} recording(s) for contact ${contactId}`);
    return { ok: true };
  }
}
