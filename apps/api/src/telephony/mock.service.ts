import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { mapDirection, mapStatus, parseTime } from './normalize.util';
import { MOCK_RECORDING_BYTES, type MockCallEventPayload } from './mock.fixtures';
import type { ClickToCallParams, DownloadedRecording, NormalizedCallEvent, ProviderHealth, TelephonyProvider } from './telephony.provider';

/**
 * MOCK telephony provider — the DEFAULT (TELEPHONY_PROVIDER=mock). A first-class
 * adapter (implements TelephonyProvider) that simulates call events from fixture
 * payloads so the ENTIRE pipeline runs and every test passes WITHOUT a real
 * account. Connecting MyOperator is then the one-line switch to
 * TELEPHONY_PROVIDER=myoperator (+ credentials) — no business-logic change.
 */
@Injectable()
export class MockTelephonyService implements TelephonyProvider {
  readonly id = 'mock' as const;
  private readonly logger = new Logger(MockTelephonyService.name);

  /**
   * Calls the provider "knows about". The reconciliation sweep pulls these via
   * fetchRecentCalls; staging one WITHOUT delivering its webhook simulates a
   * MISSED webhook the sweep then recovers.
   */
  private readonly recentCalls: MockCallEventPayload[] = [];

  constructor(private readonly config: ConfigService<Env, true>) {}

  isMock(): boolean {
    return true;
  }

  callerId(): string | null {
    return (
      this.config.get('MOCK_CALLER_ID', { infer: true }) ??
      this.config.get('MYOPERATOR_CALLER_ID', { infer: true }) ??
      '+911100000000'
    );
  }

  async clickToCall(params: ClickToCallParams): Promise<{ externalCallId: string }> {
    const externalCallId = `mock_${Date.now()}_${Math.round(Math.random() * 1e6)}`;
    this.logger.log(`[mock] click-to-call ${params.agentNumber} → ${params.customerNumber} (${externalCallId})`);
    return { externalCallId };
  }

  /**
   * HMAC-SHA256 of the raw body against MOCK_WEBHOOK_SECRET — the same shape as
   * the real adapters, so the signature-valid/invalid criterion runs on the mock.
   * Dev-lenient (true) only when the secret is unset.
   */
  verifySignature(rawBody: string, signature: string | undefined): boolean {
    const secret = this.secret();
    if (!secret) return true;
    if (!signature) return false;
    const expected = Buffer.from(this.sign(rawBody));
    const provided = Buffer.from(signature);
    return expected.length === provided.length && timingSafeEqual(expected, provided);
  }

  /** Produce a valid signature for a raw body (fixtures/tests use this). */
  sign(rawBody: string): string {
    return createHmac('sha256', this.secret() ?? '').update(rawBody).digest('hex');
  }

  webhookSecretConfigured(): boolean {
    return !!this.secret();
  }

  /** Map a fixture payload to the provider-neutral event (reuses shared normalizers). */
  parseEvent(raw: unknown): NormalizedCallEvent {
    const p = (raw ?? {}) as MockCallEventPayload;
    const duration = p.duration != null ? Number(p.duration) : null;
    return {
      externalCallId: p.callId ?? null,
      companyId: p.companyId ?? null,
      direction: mapDirection(p.direction),
      status: mapStatus(p.status, Number.isFinite(duration) ? duration : null),
      fromNumber: p.from ?? null,
      toNumber: p.to ?? null,
      agentNumber: p.agent ?? null,
      startedAt: parseTime(p.startTime != null ? String(p.startTime) : undefined),
      answeredAt: parseTime(p.answerTime != null ? String(p.answerTime) : undefined),
      endedAt: parseTime(p.endTime != null ? String(p.endTime) : undefined),
      durationSeconds: Number.isFinite(duration) ? (duration as number) : null,
      recordingUrl: p.recordingUrl ?? null,
    };
  }

  /** Return the fixture recording buffer (no network) so it stores to Cloudinary. */
  async downloadRecording(url: string): Promise<DownloadedRecording> {
    const buffer = Buffer.from(MOCK_RECORDING_BYTES);
    this.logger.log(`[mock] download recording ${url} (${buffer.byteLength} bytes)`);
    return { buffer, contentType: 'audio/mpeg', sizeBytes: buffer.byteLength };
  }

  /** The reconciliation source: recent calls at or after `since`. */
  async fetchRecentCalls(since: Date): Promise<NormalizedCallEvent[]> {
    return this.recentCalls
      .filter((c) => {
        const t = parseTime(c.startTime != null ? String(c.startTime) : undefined);
        return !t || t.getTime() >= since.getTime();
      })
      .map((c) => this.parseEvent(c));
  }

  async healthCheck(): Promise<ProviderHealth> {
    return 'up';
  }

  // ---- Simulation hooks (mock only) --------------------------------------
  /** Stage a call at the provider as if its webhook was never delivered. */
  stageRecentCall(payload: MockCallEventPayload): void {
    this.recentCalls.push(payload);
  }

  /** Clear staged calls (test isolation). */
  resetRecentCalls(): void {
    this.recentCalls.length = 0;
  }

  private secret(): string | undefined {
    return this.config.get('MOCK_WEBHOOK_SECRET', { infer: true });
  }
}
