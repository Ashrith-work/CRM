import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Env } from '../config/env';
import { IncentiveService } from './incentive.service';
import { INCENTIVE_EXPIRE_JOB_ID, INCENTIVE_QUEUE } from './incentive.constants';

/**
 * Expires ACTIVE incentives past their validity window. Repeatable (~hourly,
 * stable jobId) so it survives restarts; a window that lapsed during a redeploy
 * is expired on the next tick.
 */
@Processor(INCENTIVE_QUEUE, { concurrency: 1 })
export class IncentiveProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(IncentiveProcessor.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly incentives: IncentiveService,
    @InjectQueue(INCENTIVE_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    const every = this.config.get('INCENTIVE_SWEEP_INTERVAL_MS', { infer: true });
    await this.queue.add('expire', {}, { repeat: { every }, jobId: INCENTIVE_EXPIRE_JOB_ID, removeOnComplete: true, removeOnFail: 20 });
    await this.queue.add('expire', {}, { jobId: 'incentive-expire-boot', delay: 30_000, removeOnComplete: true, removeOnFail: 5 });
    this.logger.log(`Incentive expiry sweep scheduled every ${every}ms`);
  }

  async process(): Promise<{ expired: number }> {
    return { expired: await this.incentives.expireDue() };
  }
}
