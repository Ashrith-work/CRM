import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { ConnectMetaInput, MetaStatus, SyncNowResponse } from '@crm/types';
import { Prisma, type Integration } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MetaService } from './meta.service';
import { ADS_QUEUE, META_PROVIDER, type AdsJob } from './ads.constants';

interface MetaConfig {
  adAccountId?: string;
  businessId?: string;
  apiVersion?: string;
  accountName?: string;
  currency?: string;
  reason?: string;
}

/**
 * Owns the Meta Integration row + status the Settings panel reads. connect()
 * verifies the ad account with a cheap Graph call; a failure keeps the row
 * not_connected with a readable reason (never a crash). sync-now enqueues the
 * metrics pull onto the worker (never runs it in the request).
 */
@Injectable()
export class MetaConnectService {
  private readonly logger = new Logger(MetaConnectService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly meta: MetaService,
    @InjectQueue(ADS_QUEUE) private readonly queue: Queue,
  ) {}

  async connect(organizationId: string, actorId: string, input: ConnectMetaInput): Promise<MetaStatus> {
    const apiVersion = this.meta.apiVersion();
    const conn = this.meta.connection({ adAccountId: input.adAccountId, businessId: input.businessId });

    if (!conn) {
      await this.upsert(organizationId, 'DISCONNECTED', { adAccountId: input.adAccountId, businessId: input.businessId, apiVersion, reason: 'Missing META_ACCESS_TOKEN or META_AD_ACCOUNT_ID' }, actorId, false);
      return this.status(organizationId);
    }

    try {
      const account = await this.meta.getAdAccount(conn);
      await this.upsert(
        organizationId,
        'CONNECTED',
        { adAccountId: conn.adAccountId, businessId: conn.businessId ?? undefined, apiVersion, accountName: account.name, currency: account.currency, reason: undefined },
        actorId,
        true,
      );
      // Record the ad account entity too.
      await this.prisma.adAccount.upsert({
        where: { organizationId_externalId: { organizationId, externalId: account.id } },
        update: { name: account.name, currency: account.currency, status: account.status },
        create: { organizationId, externalId: account.id, name: account.name, currency: account.currency, status: account.status },
      });
    } catch (err) {
      const reason = (err as Error).message || 'Meta credential verification failed';
      await this.upsert(organizationId, 'DISCONNECTED', { adAccountId: conn.adAccountId, businessId: conn.businessId ?? undefined, apiVersion, reason }, actorId, false);
    }
    return this.status(organizationId);
  }

  async disconnect(organizationId: string): Promise<MetaStatus> {
    await this.prisma.integration.updateMany({
      where: { organizationId, provider: META_PROVIDER },
      data: { status: 'DISCONNECTED', connectedAt: null },
    });
    return this.status(organizationId);
  }

  async status(organizationId: string): Promise<MetaStatus> {
    const integration = await this.integration(organizationId);
    const cfg = (integration?.config as MetaConfig | null) ?? {};
    const metricRowCount = await this.prisma.adMetricDaily.count({ where: { organizationId } });
    return {
      provider: 'meta',
      status: integration?.status ?? 'DISCONNECTED',
      adAccountId: cfg.adAccountId ?? null,
      businessId: cfg.businessId ?? null,
      apiVersion: cfg.apiVersion ?? this.meta.apiVersion(),
      lastSyncedAt: integration?.lastSyncedAt ? integration.lastSyncedAt.toISOString() : null,
      metricRowCount,
      reason: cfg.reason ?? null,
    };
  }

  async syncNow(organizationId: string): Promise<SyncNowResponse> {
    const jobId = `meta_metrics_${organizationId}`;
    await this.queue.add('metrics', { type: 'metrics', organizationId } satisfies AdsJob, {
      jobId,
      removeOnComplete: true,
      removeOnFail: 50,
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
    });
    return { enqueued: true, jobId };
  }

  // ----- helpers used by the worker ---------------------------------------
  async markSynced(organizationId: string): Promise<void> {
    await this.prisma.integration.updateMany({ where: { organizationId, provider: META_PROVIDER }, data: { lastSyncedAt: new Date() } });
  }

  async connectionFor(organizationId: string) {
    const integration = await this.integration(organizationId);
    const cfg = (integration?.config as MetaConfig | null) ?? {};
    return this.meta.connection({ adAccountId: cfg.adAccountId, businessId: cfg.businessId });
  }

  private integration(organizationId: string): Promise<Integration | null> {
    return this.prisma.integration.findUnique({ where: { organizationId_provider: { organizationId, provider: META_PROVIDER } } });
  }

  private async upsert(organizationId: string, status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR' | 'PAUSED', config: MetaConfig, actorId: string | null, connected: boolean): Promise<void> {
    const data = {
      status,
      config: config as Prisma.InputJsonValue,
      ...(connected ? { connectedById: actorId, connectedAt: new Date() } : {}),
    };
    await this.prisma.integration.upsert({
      where: { organizationId_provider: { organizationId, provider: META_PROVIDER } },
      update: data,
      create: { organizationId, provider: META_PROVIDER, ...data },
    });
  }
}
