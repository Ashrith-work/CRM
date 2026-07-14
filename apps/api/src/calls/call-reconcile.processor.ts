import { Inject, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Env } from '../config/env';
import { TELEPHONY_PROVIDER, type TelephonyProvider } from '../telephony/telephony.provider';
import { classifyTelephonyError } from '../telephony/telephony-status.service';
import { CallsService } from './calls.service';
import { RECONCILE_JOB_ID, TELEPHONY_RECONCILE_QUEUE } from './call-reconcile.constants';

/**
 * Telephony reconciliation sweep — the self-healing recovery for MISSED webhooks.
 * A repeatable job re-pulls recent calls from the ACTIVE provider and idempotently
 * upserts each via the shared CallsService.processWebhookEvent — a call that never
 * webhooked gets created; one that did is a no-op (dedupe on org+externalCallId).
 *
 * Resilient by design: transient/provider-down failures are already retried inside
 * the provider's HTTP wrapper; anything that still throws here is logged and the
 * next tick retries (DELAYED, not failed). An un-recoverable auth/config error is
 * surfaced loudly (per-org Integration surfacing happens on the webhook +
 * click-to-call paths, which have an org in hand).
 */
@Processor(TELEPHONY_RECONCILE_QUEUE)
export class CallReconcileProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(CallReconcileProcessor.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    @Inject(TELEPHONY_PROVIDER) private readonly provider: TelephonyProvider,
    private readonly calls: CallsService,
    @InjectQueue(TELEPHONY_RECONCILE_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  /** Register (or refresh) the single repeatable sweep job on boot. */
  async onModuleInit(): Promise<void> {
    const every = this.config.get('TELEPHONY_RECONCILE_INTERVAL_MS', { infer: true });
    await this.queue.add(
      'sweep',
      { type: 'sweep' },
      { repeat: { every }, jobId: RECONCILE_JOB_ID, removeOnComplete: true, removeOnFail: 50 },
    );
    this.logger.log(`Telephony reconciliation scheduled every ${every}ms (provider: ${this.provider.id})`);
  }

  async process(): Promise<{ pulled: number; filled: number }> {
    // Look back two intervals so an event missed near a tick boundary is still caught.
    const lookbackMs = this.config.get('TELEPHONY_RECONCILE_INTERVAL_MS', { infer: true }) * 2;
    const since = new Date(Date.now() - lookbackMs);

    let events;
    try {
      events = await this.provider.fetchRecentCalls(since);
    } catch (err) {
      const classified = classifyTelephonyError(err);
      if (classified) {
        this.logger.error(`Reconciliation: ${classified.kind} — ${classified.reason} (needs a human)`);
      } else {
        this.logger.warn(`Reconciliation pull failed (will retry next tick): ${(err as Error).message}`);
      }
      return { pulled: 0, filled: 0 };
    }

    let filled = 0;
    for (const event of events) {
      try {
        const { created } = await this.calls.processWebhookEvent(event);
        if (created) filled += 1;
      } catch (err) {
        this.logger.warn(`Reconciliation: failed to process ${event.externalCallId ?? '?'}: ${(err as Error).message}`);
      }
    }
    if (filled > 0) this.logger.log(`Reconciliation filled ${filled} missed call(s) of ${events.length} pulled`);
    return { pulled: events.length, filled };
  }
}
