import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { ConnectShopifyInput, ShopifyStatus, SyncJobStatus, SyncNowResponse } from '@crm/types';
import { Prisma, type Integration } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { Env } from '../config/env';
import { ShopifyService } from './shopify.service';
import { verifyShopifyHmac } from './shopify-hmac.util';
import { SHOPIFY_SYNC_QUEUE, type BackfillJob, type WebhookJob } from './commerce.constants';

const PROVIDER = 'shopify';

export interface ShopifyWebhookHeaders {
  hmac?: string;
  topic?: string;
  webhookId?: string;
  shopDomain?: string;
}

export type WebhookOutcome = 'ok' | 'unauthorized' | 'duplicate' | 'ignored';

interface ShopifyConfig {
  shopDomain?: string;
  apiVersion?: string;
  shopName?: string;
  reason?: string;
  sync?: SyncJobStatus;
}

/**
 * Manages the Shopify Integration row + the sync-status the Settings panel reads.
 * connect() verifies credentials with a cheap shop call; a failure keeps the row
 * not_connected with a readable reason (never a crash). sync-now enqueues the
 * backfill onto the worker (never runs it in the request).
 */
@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly shopify: ShopifyService,
    @InjectQueue(SHOPIFY_SYNC_QUEUE) private readonly queue: Queue,
  ) {}

  async connect(organizationId: string, actorId: string, input: ConnectShopifyInput): Promise<ShopifyStatus> {
    const apiVersion = input.apiVersion || this.shopify.apiVersion();
    const conn = this.shopify.connection(input.shopDomain);

    if (!conn) {
      await this.upsert(organizationId, 'DISCONNECTED', { shopDomain: input.shopDomain, apiVersion, reason: 'Missing SHOPIFY_ADMIN_ACCESS_TOKEN (or shop domain)' }, actorId, false);
      return this.status(organizationId);
    }

    try {
      const shop = await this.shopify.getShop(conn);
      await this.upsert(organizationId, 'CONNECTED', { shopDomain: input.shopDomain, apiVersion, shopName: shop.name, reason: undefined }, actorId, true);
    } catch (err) {
      const reason = (err as Error).message || 'Shopify credential verification failed';
      await this.upsert(organizationId, 'DISCONNECTED', { shopDomain: input.shopDomain, apiVersion, reason }, actorId, false);
    }
    return this.status(organizationId);
  }

  async status(organizationId: string): Promise<ShopifyStatus> {
    const integration = await this.integration(organizationId);
    const cfg = (integration?.config as ShopifyConfig | null) ?? {};
    const crmOrderCount = await this.prisma.order.count({ where: { organizationId, deletedAt: null } });

    let shopifyOrderCount: number | null = null;
    if (integration?.status === 'CONNECTED') {
      const conn = this.shopify.connection(cfg.shopDomain);
      if (conn) {
        try {
          shopifyOrderCount = await this.shopify.orderCount(conn);
        } catch (err) {
          this.logger.warn(`Shopify order count failed: ${(err as Error).message}`);
        }
      }
    }

    return {
      provider: 'shopify',
      status: integration?.status ?? 'DISCONNECTED',
      shopDomain: cfg.shopDomain ?? null,
      apiVersion: cfg.apiVersion ?? this.shopify.apiVersion(),
      lastSyncedAt: integration?.lastSyncedAt ? integration.lastSyncedAt.toISOString() : null,
      crmOrderCount,
      shopifyOrderCount,
      reason: cfg.reason ?? null,
      sync: cfg.sync ?? null,
    };
  }

  async syncNow(organizationId: string): Promise<SyncNowResponse> {
    const jobId = `backfill_${organizationId}`;
    await this.setSync(organizationId, { state: 'running', phase: 'queued', processed: 0, total: null, startedAt: new Date().toISOString(), finishedAt: null, error: null });
    await this.queue.add('backfill', { type: 'backfill', organizationId } satisfies BackfillJob, {
      jobId,
      removeOnComplete: true,
      removeOnFail: 100,
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
    });
    return { enqueued: true, jobId };
  }

  /**
   * Verify + dedup + enqueue a Shopify webhook. HMAC is checked over the RAW
   * body BEFORE any DB touch; idempotency is the WebhookDelivery unique key
   * (a retry → 'duplicate', no-op). Heavy work is pushed to the worker (ack fast).
   */
  async handleWebhook(raw: string, headers: ShopifyWebhookHeaders): Promise<WebhookOutcome> {
    const secret =
      this.config.get('SHOPIFY_WEBHOOK_SECRET', { infer: true }) ||
      this.config.get('SHOPIFY_API_SECRET', { infer: true });
    if (!verifyShopifyHmac(raw, secret, headers.hmac)) return 'unauthorized';
    if (!headers.topic || !headers.webhookId) return 'ignored';

    const organizationId = await this.resolveOrgByDomain(headers.shopDomain);
    if (!organizationId) {
      this.logger.warn(`Webhook for unknown shop ${headers.shopDomain ?? '?'} — ignored`);
      return 'ignored';
    }

    // Dedup ledger: a retried delivery trips the unique constraint → no-op.
    try {
      await this.prisma.webhookDelivery.create({
        data: { organizationId, provider: PROVIDER, eventId: headers.webhookId, topic: headers.topic },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return 'duplicate';
      throw err;
    }

    const payload = JSON.parse(raw) as Record<string, unknown>;
    await this.queue.add(
      'webhook',
      { type: 'webhook', organizationId, topic: headers.topic, payload } satisfies WebhookJob,
      { removeOnComplete: true, removeOnFail: 500, attempts: 5, backoff: { type: 'exponential', delay: 5_000 } },
    );
    return 'ok';
  }

  private async resolveOrgByDomain(shopDomain: string | undefined): Promise<string | null> {
    const rows = await this.prisma.integration.findMany({ where: { provider: PROVIDER }, select: { organizationId: true, config: true } });
    if (rows.length === 1 && !shopDomain) return rows[0].organizationId; // single-store convenience
    const match = rows.find((r) => (r.config as ShopifyConfig | null)?.shopDomain === shopDomain);
    return match?.organizationId ?? null;
  }

  // ----- sync-state helpers used by the worker ----------------------------
  async setSync(organizationId: string, sync: SyncJobStatus): Promise<void> {
    const integration = await this.integration(organizationId);
    const cfg = ((integration?.config as ShopifyConfig | null) ?? {}) as ShopifyConfig;
    await this.upsert(organizationId, integration?.status ?? 'CONNECTED', { ...cfg, sync }, null, false);
  }

  async markSynced(organizationId: string): Promise<void> {
    await this.prisma.integration.updateMany({
      where: { organizationId, provider: PROVIDER },
      data: { lastSyncedAt: new Date() },
    });
  }

  async connectionFor(organizationId: string) {
    const integration = await this.integration(organizationId);
    const cfg = (integration?.config as ShopifyConfig | null) ?? {};
    return this.shopify.connection(cfg.shopDomain);
  }

  private integration(organizationId: string): Promise<Integration | null> {
    return this.prisma.integration.findUnique({ where: { organizationId_provider: { organizationId, provider: PROVIDER } } });
  }

  private async upsert(
    organizationId: string,
    status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR' | 'PAUSED',
    config: ShopifyConfig,
    actorId: string | null,
    connected: boolean,
  ): Promise<void> {
    const data = {
      status,
      config: config as Prisma.InputJsonValue,
      ...(connected ? { connectedById: actorId, connectedAt: new Date() } : {}),
    };
    await this.prisma.integration.upsert({
      where: { organizationId_provider: { organizationId, provider: PROVIDER } },
      update: data,
      create: { organizationId, provider: PROVIDER, ...data },
    });
  }
}
