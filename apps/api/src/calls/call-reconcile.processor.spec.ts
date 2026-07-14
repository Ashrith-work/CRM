import type { Queue } from 'bullmq';
import type { ConfigService } from '@nestjs/config';
import { CallReconcileProcessor } from './call-reconcile.processor';
import { MockTelephonyService } from '../telephony/mock.service';
import { makeMockEvent } from '../telephony/mock.fixtures';
import { TelephonyAuthError } from '../telephony/http.util';
import type { CallsService } from './calls.service';
import type { Env } from '../config/env';

const config = { get: () => 300_000 } as unknown as ConfigService<Env, true>;

function mockProvider(): MockTelephonyService {
  return new MockTelephonyService({ get: (k: string) => ({ MOCK_WEBHOOK_SECRET: 'mock-webhook-secret' } as Record<string, unknown>)[k] } as never);
}

/** A CallsService stand-in that dedupes on externalCallId like the real upsert. */
function fakeCalls() {
  const seen = new Set<string>();
  const processWebhookEvent = jest.fn(async (event: { externalCallId: string | null }) => {
    const id = event.externalCallId ?? '';
    const created = !seen.has(id);
    seen.add(id);
    return { callId: id, created };
  });
  return { calls: { processWebhookEvent } as unknown as CallsService, processWebhookEvent };
}

describe('CallReconcileProcessor (missed-webhook recovery)', () => {
  const now = () => new Date().toISOString();

  it('fills a missed webhook: a staged provider call becomes a new Call', async () => {
    const provider = mockProvider();
    provider.stageRecentCall(makeMockEvent({ callId: 'missed1', startTime: now() }));
    const { calls, processWebhookEvent } = fakeCalls();

    const out = await new CallReconcileProcessor(config, provider, calls, {} as Queue).process();

    expect(out).toEqual({ pulled: 1, filled: 1 });
    expect(processWebhookEvent).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: re-running the sweep does not create a duplicate', async () => {
    const provider = mockProvider();
    provider.stageRecentCall(makeMockEvent({ callId: 'missed1', startTime: now() }));
    const { calls } = fakeCalls();
    const proc = new CallReconcileProcessor(config, provider, calls, {} as Queue);

    const first = await proc.process();
    const second = await proc.process();

    expect(first.filled).toBe(1);
    expect(second.filled).toBe(0); // already present → no new Call
  });

  it('tolerates a provider outage: swallows, returns zero, never throws', async () => {
    const provider = mockProvider();
    jest.spyOn(provider, 'fetchRecentCalls').mockRejectedValue(new Error('ECONNREFUSED'));
    const { calls } = fakeCalls();

    await expect(new CallReconcileProcessor(config, provider, calls, {} as Queue).process()).resolves.toEqual({ pulled: 0, filled: 0 });
  });

  it('surfaces an un-recoverable auth error without throwing the worker', async () => {
    const provider = mockProvider();
    jest.spyOn(provider, 'fetchRecentCalls').mockRejectedValue(new TelephonyAuthError('bad key'));
    const { calls } = fakeCalls();

    await expect(new CallReconcileProcessor(config, provider, calls, {} as Queue).process()).resolves.toEqual({ pulled: 0, filled: 0 });
  });
});
