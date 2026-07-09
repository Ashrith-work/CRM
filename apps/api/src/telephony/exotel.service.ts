import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { mapDirection, mapStatus, parseTime } from './normalize.util';
import type { ClickToCallParams, DownloadedRecording, NormalizedCallEvent, TelephonyProvider } from './telephony.provider';

type Raw = Record<string, unknown>;
const str = (v: unknown): string | undefined => (v == null ? undefined : String(v));

/**
 * Exotel adapter (implements TelephonyProvider). Same seam as MyOperator:
 * click-to-call via the Exotel Call/connect API (HTTP Basic auth), webhook
 * verification, normalized event mapping (Exotel status-callback params), and
 * recording download. MOCK mode when EXOTEL_API_TOKEN is unset.
 */
@Injectable()
export class ExotelService implements TelephonyProvider {
  readonly id = 'exotel' as const;
  private readonly logger = new Logger(ExotelService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  isMock(): boolean {
    return !this.config.get('EXOTEL_API_TOKEN', { infer: true }) || !this.config.get('EXOTEL_ACCOUNT_SID', { infer: true });
  }

  callerId(): string | null {
    return this.config.get('EXOTEL_CALLER_ID', { infer: true }) ?? null;
  }

  private authHeader(): string {
    const key = this.config.get('EXOTEL_API_KEY', { infer: true }) ?? '';
    const token = this.config.get('EXOTEL_API_TOKEN', { infer: true }) ?? '';
    return `Basic ${Buffer.from(`${key}:${token}`).toString('base64')}`;
  }

  async clickToCall(params: ClickToCallParams): Promise<{ externalCallId: string }> {
    if (this.isMock()) {
      const externalCallId = `mock_${Date.now()}_${Math.round(Math.random() * 1e6)}`;
      this.logger.log(`[mock] exotel connect ${params.agentNumber} → ${params.customerNumber} (${externalCallId})`);
      return { externalCallId };
    }
    const sid = this.config.get('EXOTEL_ACCOUNT_SID', { infer: true });
    const url = `${this.config.get('EXOTEL_API_URL', { infer: true })}/v1/Accounts/${sid}/Calls/connect.json`;
    const form = new URLSearchParams({
      From: params.agentNumber, // first leg dialed = the agent
      To: params.customerNumber,
      CallerId: this.callerId() ?? '',
    });
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: this.authHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    if (!res.ok) throw new Error(`Exotel connect failed: ${res.status} ${await res.text().catch(() => '')}`);
    const json = (await res.json()) as { Call?: { Sid?: string } };
    const externalCallId = json.Call?.Sid;
    if (!externalCallId) throw new Error('Exotel connect returned no Call Sid');
    return { externalCallId };
  }

  /**
   * HMAC-SHA256 of the raw body against EXOTEL_WEBHOOK_SECRET (via x-exotel-signature).
   * Exotel typically secures callbacks with HTTP Basic auth on the URL; this HMAC
   * is our added layer. Dev-lenient (true) when no secret is configured.
   */
  verifySignature(rawBody: string, signature: string | undefined): boolean {
    const secret = this.config.get('EXOTEL_WEBHOOK_SECRET', { infer: true });
    if (!secret) return true;
    if (!signature) return false;
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  webhookSecretConfigured(): boolean {
    return !!this.config.get('EXOTEL_WEBHOOK_SECRET', { infer: true });
  }

  /** Map an Exotel status-callback payload (JSON or form fields) to our event. */
  parseEvent(raw: unknown): NormalizedCallEvent {
    const p = (raw ?? {}) as Raw;
    const duration = p.ConversationDuration ?? p.DialCallDuration ?? p.Duration;
    const durationSeconds = duration != null ? Number(duration) : null;
    return {
      externalCallId: str(p.CallSid) ?? null,
      // Exotel callbacks don't echo the account SID; use the configured one so an
      // org can be mapped by Organization.exotelAccountSid.
      companyId: this.config.get('EXOTEL_ACCOUNT_SID', { infer: true }) ?? null,
      direction: mapDirection(str(p.Direction)),
      status: mapStatus(str(p.Status) ?? str(p.CallStatus), Number.isFinite(durationSeconds) ? durationSeconds : null),
      fromNumber: str(p.From) ?? str(p.CallFrom) ?? null,
      toNumber: str(p.To) ?? str(p.CallTo) ?? null,
      agentNumber: str(p.DialWhomNumber) ?? null,
      startedAt: parseTime(str(p.StartTime)),
      answeredAt: parseTime(str(p.StartTime)),
      endedAt: parseTime(str(p.EndTime)),
      durationSeconds: Number.isFinite(durationSeconds) ? (durationSeconds as number) : null,
      recordingUrl: str(p.RecordingUrl) ?? null,
    };
  }

  async downloadRecording(url: string): Promise<DownloadedRecording> {
    const headers: Record<string, string> = {};
    if (!this.isMock()) headers.Authorization = this.authHeader();
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Recording download failed: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, contentType: res.headers.get('content-type') ?? 'audio/mpeg', sizeBytes: buffer.byteLength };
  }
}
