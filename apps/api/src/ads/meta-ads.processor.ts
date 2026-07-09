import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue, type Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import type { Env } from '../config/env';
import { AttributionRefreshService } from '../attribution/attribution-refresh.service';
import { AudienceService } from '../audiences/audience.service';
import { MetaConnectService } from './meta-connect.service';
import { MetaSyncService } from './meta-sync.service';
import {
  ADS_QUEUE,
  ADS_REFRESH_JOB_ID,
  AUDIENCE_RESYNC_JOB_ID,
  META_LEADS_JOB_ID,
  META_METRICS_JOB_ID,
  META_PROVIDER,
  type AdsJob,
} from './ads.constants';

/**
 * Meta ads worker (never in a request):
 *  - "metrics": daily Insights pull for the hierarchy (idempotent upserts).
 *  - "leads": Lead-Ads import + first-touch touchpoint + conversion re-attribution.
 *  - "refresh": capture order touchpoints → refresh source_ltv_cac / ad_performance.
 *  - "audiences": nightly re-sync of every audience so withdrawn consent drops out.
 */
@Processor(ADS_QUEUE, { concurrency: 1 })
export class MetaAdsProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(MetaAdsProcessor.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
    private readonly connect: MetaConnectService,
    private readonly sync: MetaSyncService,
    private readonly attributionRefresh: AttributionRefreshService,
    private readonly audiences: AudienceService,
    @InjectQueue(ADS_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    const every = this.config.get('META_METRICS_INTERVAL_MS', { infer: true });
    const opts = (jobId: string) => ({ repeat: { every }, jobId, removeOnComplete: true, removeOnFail: 20 });
    await this.queue.add('metrics', { type: 'metrics' } satisfies AdsJob, opts(META_METRICS_JOB_ID));
    await this.queue.add('leads', { type: 'leads' } satisfies AdsJob, opts(META_LEADS_JOB_ID));
    await this.queue.add('refresh', { type: 'refresh' } satisfies AdsJob, opts(ADS_REFRESH_JOB_ID));
    await this.queue.add('audiences', { type: 'audiences' } satisfies AdsJob, opts(AUDIENCE_RESYNC_JOB_ID));
    // One-shot soon after boot so a fresh deploy has ad data + views populated.
    await this.queue.add('metrics', { type: 'metrics' } satisfies AdsJob, { jobId: 'meta-metrics-boot', delay: 20_000, removeOnComplete: true, removeOnFail: 5 });
    await this.queue.add('refresh', { type: 'refresh' } satisfies AdsJob, { jobId: 'ads-refresh-boot', delay: 40_000, removeOnComplete: true, removeOnFail: 5 });
    this.logger.log(`Meta ads worker scheduled (metrics/leads/refresh/audiences every ${every}ms)`);
  }

  async process(job: Job<AdsJob>): Promise<unknown> {
    switch (job.data.type) {
      case 'metrics':
        return this.runForConnected(job.data.organizationId, (org, conn) => this.sync.pullMetrics(org, conn), 'metrics');
      case 'leads':
        return this.runForConnected(job.data.organizationId, (org, conn) => this.sync.pullLeads(org, conn), 'leads');
      case 'refresh':
        return this.attributionRefresh.refreshAll();
      case 'audiences':
        return this.resyncAudiences();
    }
  }

  private async runForConnected<T>(
    organizationId: string | undefined,
    fn: (org: string, conn: NonNullable<Awaited<ReturnType<MetaConnectService['connectionFor']>>>) => Promise<T>,
    label: string,
  ): Promise<{ ran: number }> {
    const targets = organizationId ? [organizationId] : await this.connectedOrgs();
    let ran = 0;
    for (const org of targets) {
      const conn = await this.connect.connectionFor(org);
      if (!conn) continue; // not connected → skip gracefully (MOCK/not_connected)
      try {
        await fn(org, conn);
        if (label === 'metrics') await this.connect.markSynced(org);
        ran++;
      } catch (err) {
        this.logger.error(`Meta ${label} failed for ${org}: ${(err as Error).message}`);
      }
    }
    return { ran };
  }

  /** Re-run every recorded audience through the ConsentGate (drops withdrawals). */
  private async resyncAudiences(): Promise<{ resynced: number }> {
    const rows = await this.prisma.audienceSync.findMany({ select: { organizationId: true, segmentId: true, type: true } });
    let resynced = 0;
    for (const r of rows) {
      try {
        await this.audiences.sync(r.organizationId, 'system', { segmentId: r.segmentId, type: r.type });
        resynced++;
      } catch (err) {
        this.logger.warn(`Audience re-sync failed for segment ${r.segmentId}: ${(err as Error).message}`);
      }
    }
    return { resynced };
  }

  private async connectedOrgs(): Promise<string[]> {
    const rows = await this.prisma.integration.findMany({ where: { provider: META_PROVIDER, status: 'CONNECTED' }, select: { organizationId: true } });
    return rows.map((r) => r.organizationId);
  }
}
