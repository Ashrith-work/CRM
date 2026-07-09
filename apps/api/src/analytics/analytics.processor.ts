import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Env } from '../config/env';
import { RfmRefreshService } from './rfm-refresh.service';
import { ChurnScoreService } from './churn-score.service';
import { TierService } from './tier.service';
import { SegmentService } from '../segments/segment.service';
import { ANALYTICS_QUEUE, RFM_REFRESH_JOB_ID, type AnalyticsRefreshJob } from './analytics.constants';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

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
    private readonly churn: ChurnScoreService,
    private readonly tiers: TierService,
    private readonly segments: SegmentService,
    @InjectQueue(ANALYTICS_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    const every = this.config.get('RFM_REFRESH_INTERVAL_MS', { infer: true });
    // Nightly: views + RFM + CLV + dynamic segments.
    await this.queue.add('refresh', { type: 'refresh' } satisfies AnalyticsRefreshJob, { repeat: { every }, jobId: RFM_REFRESH_JOB_ID, removeOnComplete: true, removeOnFail: 20 });
    // Weekly: heuristic churn (tiered refresh).
    await this.queue.add('churn', { type: 'churn' }, { repeat: { every: WEEK_MS }, jobId: 'churn-score-repeat', removeOnComplete: true, removeOnFail: 20 });
    // One-time runs soon after boot so everything is populated immediately.
    await this.queue.add('refresh', { type: 'refresh' } satisfies AnalyticsRefreshJob, { jobId: 'rfm-refresh-boot', delay: 10_000, removeOnComplete: true, removeOnFail: 5 });
    await this.queue.add('churn', { type: 'churn' }, { jobId: 'churn-boot', delay: 20_000, removeOnComplete: true, removeOnFail: 5 });
    this.logger.log(`Analytics refresh scheduled (views+RFM+CLV every ${every}ms; churn weekly)`);
  }

  async process(job: { name: string }): Promise<unknown> {
    if (job.name === 'churn') return this.churn.scoreAll();
    const rfm = await this.rfm.refreshAll();
    // Tiers depend on CLV/spend features, so assign them right after the refresh.
    const tiered = await this.tiers.assignAll();
    const segments = await this.segments.refreshDynamic();
    return { rfm, tiered, segments };
  }
}
