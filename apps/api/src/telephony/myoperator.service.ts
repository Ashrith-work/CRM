import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CallDirection, CallStatus, MyOperatorWebhook } from '@crm/types';
import type { Env } from '../config/env';

export interface ClickToCallParams {
  agentNumber: string;
  customerNumber: string;
}

/** A MyOperator webhook mapped to our normalized call event shape. */
export interface NormalizedCallEvent {
  externalCallId: string | null;
  companyId: string | null;
  direction: CallDirection;
  status: CallStatus;
  fromNumber: string | null;
  toNumber: string | null;
  agentNumber: string | null;
  startedAt: Date | null;
  answeredAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number | null;
  recordingUrl: string | null;
}

export interface DownloadedRecording {
  buffer: Buffer;
  contentType: string;
  sizeBytes: number;
}

/**
 * MyOperator adapter. Isolates all provider specifics: initiating click-to-call,
 * verifying webhook authenticity, mapping the raw event to our shape, and
 * downloading recordings. Runs in MOCK mode (no MYOPERATOR_API_TOKEN) so the
 * whole flow works locally without real telephony credentials.
 */
@Injectable()
export class MyOperatorService {
  private readonly logger = new Logger(MyOperatorService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  isMock(): boolean {
    return !this.config.get('MYOPERATOR_API_TOKEN', { infer: true });
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
  parseEvent(payload: MyOperatorWebhook): NormalizedCallEvent {
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

function mapDirection(raw: string | undefined): CallDirection {
  return (raw ?? '').toLowerCase().startsWith('in') ? 'INBOUND' : 'OUTBOUND';
}

/** Map a provider status/event string (+duration hint) to our CallStatus. */
export function mapStatus(raw: string | undefined, duration: number | null): CallStatus {
  const s = (raw ?? '').toLowerCase();
  if (/(answered|complete|success)/.test(s)) return 'COMPLETED';
  if (/(missed)/.test(s)) return 'MISSED';
  if (/(no[-_ ]?answer|noanswer)/.test(s)) return 'NO_ANSWER';
  if (/(fail|busy|reject|declin)/.test(s)) return 'FAILED';
  if (/(ring)/.test(s)) return 'RINGING';
  if (/(progress|ongoing|answer)/.test(s)) return 'IN_PROGRESS';
  // No/unknown status: infer from duration.
  if (duration != null) return duration > 0 ? 'COMPLETED' : 'MISSED';
  return 'RINGING';
}

function parseTime(raw: string | undefined): Date | null {
  if (!raw) return null;
  // Epoch seconds/millis?
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    const d = new Date(n < 1e12 ? n * 1000 : n);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? null : d;
}
