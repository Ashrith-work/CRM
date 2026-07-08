import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Env } from '../config/env';
import { RfmRefreshService } from './rfm-refresh.service';
import { SegmentService } from '../segments/segment.service';
import { ANALYTICS_QUEUE, RFM_REFRESH_JOB_ID, type AnalyticsRefreshJob } from './analytics.constants';

/**
 * Nightly analytics refresh (tiered per CLAUDE.md: revenue on ingest, RFM
 * nightly): REFRESH the customer_rfm view → rewrite CustomerFeatures → recompute
 * every DYNAMIC segment's membership. Also runs once shortly after boot so a
 * fresh deploy has RFM populated without waiting a day.
 */
@Processor(ANALYTICS_QUEUE, { concurrency: 1 })
export class AnalyticsProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(AnalyticsProcessor.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly rfm: RfmRefreshService,
    private readonly segments: SegmentService,
    @InjectQueue(ANALYTICS_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    const every = this.config.get('RFM_REFRESH_INTERVAL_MS', { infer: true });
    // Repeatable nightly refresh…
    await this.queue.add('refresh', { type: 'refresh' } satisfies AnalyticsRefreshJob, {
      repeat: { every },
      jobId: RFM_REFRESH_JOB_ID,
      removeOnComplete: true,
      removeOnFail: 20,
    });
    // …plus a one-time run soon after boot so RFM is populated immediately.
    await this.queue.add('refresh', { type: 'refresh' } satisfies AnalyticsRefreshJob, {
      jobId: 'rfm-refresh-boot',
      delay: 10_000,
      removeOnComplete: true,
      removeOnFail: 5,
    });
    this.logger.log(`RFM refresh scheduled every ${every}ms`);
  }

  async process(): Promise<{ rfm: { orgs: number; customers: number }; segments: number }> {
    const rfm = await this.rfm.refreshAll();
    const segments = await this.segments.refreshDynamic();
    return { rfm, segments };
  }
}
