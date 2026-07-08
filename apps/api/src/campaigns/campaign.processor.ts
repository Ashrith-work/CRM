import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue, type Job } from 'bullmq';
import type { Env } from '../config/env';
import { CampaignEngine } from './campaign-engine.service';
import { CAMPAIGN_QUEUE, ENROLL_JOB_ID, SEND_JOB_ID, type CampaignSweepJob } from './campaign.constants';

/**
 * Repeatable enrollment + send SWEEPS (restart-safe — each tick queries what's
 * due, no per-step delayed jobs). Also runs once shortly after boot.
 */
@Processor(CAMPAIGN_QUEUE, { concurrency: 1 })
export class CampaignProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(CampaignProcessor.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly engine: CampaignEngine,
    @InjectQueue(CAMPAIGN_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    const enrollEvery = this.config.get('CAMPAIGN_ENROLL_INTERVAL_MS', { infer: true });
    const sendEvery = this.config.get('CAMPAIGN_SEND_INTERVAL_MS', { infer: true });
    await this.queue.add('enroll', { type: 'enroll' } satisfies CampaignSweepJob, { repeat: { every: enrollEvery }, jobId: ENROLL_JOB_ID, removeOnComplete: true, removeOnFail: 20 });
    await this.queue.add('send', { type: 'send' } satisfies CampaignSweepJob, { repeat: { every: sendEvery }, jobId: SEND_JOB_ID, removeOnComplete: true, removeOnFail: 20 });
    // One-time run soon after boot so the loop is visibly live.
    await this.queue.add('enroll', { type: 'enroll' } satisfies CampaignSweepJob, { jobId: 'campaign-boot-enroll', delay: 8_000, removeOnComplete: true, removeOnFail: 5 });
    await this.queue.add('send', { type: 'send' } satisfies CampaignSweepJob, { jobId: 'campaign-boot-send', delay: 12_000, removeOnComplete: true, removeOnFail: 5 });
    this.logger.log(`Recovery sweeps scheduled (enroll ${enrollEvery}ms, send ${sendEvery}ms)`);
  }

  async process(job: Job<CampaignSweepJob>): Promise<{ processed: number }> {
    if (job.data.type === 'enroll') return { processed: await this.engine.runEnrollmentSweep() };
    return { processed: await this.engine.runSendSweep() };
  }
}
