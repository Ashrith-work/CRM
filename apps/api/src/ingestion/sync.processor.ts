import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue, type Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import type { Env } from '../config/env';
import { CommerceIngestService } from './commerce-ingest.service';
import { IngestionService } from './ingestion.service';
import {
  RECONCILE_ALERT_THRESHOLD,
  RECONCILE_JOB_ID,
  SHOPIFY_SYNC_QUEUE,
  type ReconcileJob,
  type SyncJob,
} from './commerce.constants';

/**
 * Shopify sync worker (never in a request):
 *  - "backfill": full historical import (customers → products → orders), with
 *    JobStatus progress; marks lastSyncedAt on completion.
 *  - "reconcile": repeatable nightly self-heal — re-import orders since
 *    lastSyncedAt and alert if CRM vs Shopify counts diverge.
 *  - "webhook": apply a live event via the SAME mappers as backfill.
 */
@Processor(SHOPIFY_SYNC_QUEUE, { concurrency: 2 })
export class SyncProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(SyncProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly ingest: CommerceIngestService,
    private readonly ingestion: IngestionService,
    @InjectQueue(SHOPIFY_SYNC_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    const every = this.config.get('RECONCILE_INTERVAL_MS', { infer: true });
    await this.queue.add('reconcile', { type: 'reconcile' } satisfies ReconcileJob, {
      repeat: { every },
      jobId: RECONCILE_JOB_ID,
      removeOnComplete: true,
      removeOnFail: 20,
    });
    this.logger.log(`Shopify reconciliation scheduled every ${every}ms`);
  }

  async process(job: Job<SyncJob>): Promise<unknown> {
    switch (job.data.type) {
      case 'backfill':
        return this.runBackfill(job.data.organizationId);
      case 'reconcile':
        return this.runReconcile(job.data.organizationId);
      case 'webhook':
        await this.ingest.processTopic(job.data.organizationId, job.data.topic, job.data.payload);
        return { ok: true };
    }
  }

  private async runBackfill(organizationId: string): Promise<unknown> {
    const conn = await this.ingestion.connectionFor(organizationId);
    if (!conn) {
      await this.ingestion.setSync(organizationId, { state: 'failed', phase: null, processed: 0, total: null, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), error: 'Shopify not connected' });
      return { ok: false };
    }
    const startedAt = new Date().toISOString();
    try {
      const counts = await this.ingest.backfill(organizationId, conn, async (phase, processed) => {
        await this.ingestion.setSync(organizationId, { state: 'running', phase, processed, total: null, startedAt, finishedAt: null, error: null });
      });
      await this.ingestion.markSynced(organizationId);
      await this.ingestion.setSync(organizationId, { state: 'completed', phase: 'orders', processed: counts.orders, total: counts.orders, startedAt, finishedAt: new Date().toISOString(), error: null });
      this.logger.log(`Backfill complete for ${organizationId}: ${JSON.stringify(counts)}`);
      return counts;
    } catch (err) {
      await this.ingestion.setSync(organizationId, { state: 'failed', phase: null, processed: 0, total: null, startedAt, finishedAt: new Date().toISOString(), error: (err as Error).message });
      throw err; // let BullMQ retry
    }
  }

  private async runReconcile(organizationId?: string): Promise<unknown> {
    const targets = organizationId
      ? [organizationId]
      : (await this.prisma.integration.findMany({ where: { provider: 'shopify', status: 'CONNECTED' }, select: { organizationId: true } })).map((r) => r.organizationId);

    const results: Array<Record<string, unknown>> = [];
    for (const org of targets) {
      const conn = await this.ingestion.connectionFor(org);
      if (!conn) continue;
      const integration = await this.prisma.integration.findUnique({ where: { organizationId_provider: { organizationId: org, provider: 'shopify' } } });
      // Rolling window: since last sync, else last 7 days.
      const since = (integration?.lastSyncedAt ?? new Date(Date.now() - 7 * 86_400_000)).toISOString();
      try {
        const r = await this.ingest.reconcile(org, conn, since);
        const drift = Math.abs(r.shopifyCount - r.crmCount);
        if (drift > RECONCILE_ALERT_THRESHOLD) {
          this.logger.warn(`Reconcile drift for ${org}: shopify=${r.shopifyCount} crm=${r.crmCount} (filled ${r.fetched})`);
          await this.ingestion.setSync(org, { state: 'completed', phase: 'reconcile', processed: r.fetched, total: r.shopifyCount, startedAt: since, finishedAt: new Date().toISOString(), error: `drift ${drift} orders — investigate` });
        } else {
          await this.ingestion.markSynced(org);
        }
        results.push({ org, ...r });
      } catch (err) {
        this.logger.error(`Reconcile failed for ${org}: ${(err as Error).message}`);
      }
    }
    return { reconciled: results };
  }
}
