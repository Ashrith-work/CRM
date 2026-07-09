import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MyOperatorWebhook } from '@crm/types';
import type { Env } from '../config/env';
import { mapDirection, mapStatus, parseTime } from './normalize.util';
import type { ClickToCallParams, DownloadedRecording, NormalizedCallEvent, TelephonyProvider } from './telephony.provider';

// Re-export the shared shapes so existing importers of this module keep working.
export type { ClickToCallParams, DownloadedRecording, NormalizedCallEvent } from './telephony.provider';
export { mapStatus } from './normalize.util';

/**
 * MyOperator adapter (implements TelephonyProvider). Isolates all provider
 * specifics: click-to-call, webhook authenticity, event mapping, and recording
 * download. Runs in MOCK mode (no MYOPERATOR_API_TOKEN) so the whole flow works
 * locally without real telephony credentials.
 */
@Injectable()
export class MyOperatorService implements TelephonyProvider {
  readonly id = 'myoperator' as const;
  private readonly logger = new Logger(MyOperatorService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  isMock(): boolean {
    return !this.config.get('MYOPERATOR_API_TOKEN', { infer: true });
  }

  callerId(): string | null {
    return this.config.get('MYOPERATOR_CALLER_ID', { infer: true }) ?? null;
  }

  /** Initiate an outbound call connecting the agent to the customer. */
  async clickToCall(params: ClickToCallParams): Promise<{ externalCallId: string }> {
    if (this.isMock()) {
      const externalCallId = `mock_${Date.now()}_${Math.round(Math.random() * 1e6)}`;
      this.logger.log(`[mock] click-to-call ${params.agentNumber} → ${params.customerNumber} (${externalCallId})`);
      return { externalCallId };
    }
    const res = await fetch(`${this.config.get('MYOPERATOR_API_URL', { infer: true })}/obd/click2call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': this.config.get('MYOPERATOR_API_TOKEN', { infer: true }) as string,
      },
      body: JSON.stringify({
        company_id: this.config.get('MYOPERATOR_COMPANY_ID', { infer: true }),
        agent_number: params.agentNumber,
        customer_number: params.customerNumber,
        caller_id: this.config.get('MYOPERATOR_CALLER_ID', { infer: true }),
      }),
    });
    if (!res.ok) throw new Error(`MyOperator click-to-call failed: ${res.status} ${await res.text().catch(() => '')}`);
    const json = (await res.json()) as { call_id?: string; data?: { call_id?: string; uuid?: string } };
    const externalCallId = json.call_id ?? json.data?.call_id ?? json.data?.uuid;
    if (!externalCallId) throw new Error('MyOperator click-to-call returned no call id');
    return { externalCallId };
  }

  /**
   * Verify webhook authenticity via HMAC-SHA256 of the raw body against
   * MYOPERATOR_WEBHOOK_SECRET. Returns true when the secret is unset (dev) —
   * the caller logs a warning in that case.
   */
  verifySignature(rawBody: string, signature: string | undefined): boolean {
    const secret = this.config.get('MYOPERATOR_WEBHOOK_SECRET', { infer: true });
    if (!secret) return true; // dev: no secret configured
    if (!signature) return false;
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  webhookSecretConfigured(): boolean {
    return !!this.config.get('MYOPERATOR_WEBHOOK_SECRET', { infer: true });
  }

  /** Map a raw MyOperator webhook to our normalized event. */
  parseEvent(raw: unknown): NormalizedCallEvent {
    const payload = raw as MyOperatorWebhook;
    const duration = payload.duration != null ? Number(payload.duration) : null;
    return {
      externalCallId: payload.call_id ?? payload.uuid ?? null,
      companyId: payload.company_id ?? null,
      direction: mapDirection(payload.direction),
      status: mapStatus(payload.status ?? payload.event, Number.isFinite(duration) ? duration : null),
      fromNumber: payload.caller_number ?? payload.from ?? null,
      toNumber: payload.receiver_number ?? payload.to ?? null,
      agentNumber: payload.agent_number ?? null,
      startedAt: parseTime(payload.start_time),
      answeredAt: parseTime(payload.answer_time),
      endedAt: parseTime(payload.end_time),
      durationSeconds: Number.isFinite(duration) ? (duration as number) : null,
      recordingUrl: payload.recording_url ?? null,
    };
  }

  /** Download a recording from the provider; caller enforces the size guard. */
  async downloadRecording(url: string): Promise<DownloadedRecording> {
    const headers: Record<string, string> = {};
    const token = this.config.get('MYOPERATOR_API_TOKEN', { infer: true });
    if (token) headers['X-API-KEY'] = token;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Recording download failed: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    return {
      buffer,
      contentType: res.headers.get('content-type') ?? 'audio/mpeg',
      sizeBytes: buffer.byteLength,
    };
  }
}
