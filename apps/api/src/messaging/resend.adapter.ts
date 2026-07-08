import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import type { MessageChannelAdapter, OutboundEmail, SendResult } from './message-channel.interface';

/**
 * Email channel via Resend. When RESEND_API_KEY is unset it runs in MOCK mode
 * (logs + returns a synthetic id) so the loop works end-to-end without creds.
 * Throws on provider failure so the send worker marks the send DELAYED + retries.
 */
@Injectable()
export class ResendAdapter implements MessageChannelAdapter {
  readonly channel = 'EMAIL' as const;
  private readonly logger = new Logger(ResendAdapter.name);
  private readonly apiKey?: string;
  private readonly defaultFrom: string;

  constructor(config: ConfigService<Env, true>) {
    this.apiKey = config.get('RESEND_API_KEY', { infer: true });
    this.defaultFrom = config.get('EMAIL_FROM', { infer: true });
  }

  async send(msg: OutboundEmail): Promise<SendResult> {
    const from = msg.from ?? this.defaultFrom;
    if (!this.apiKey) {
      const providerMessageId = `mock_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
      this.logger.log(`[MOCK email] ${from} → ${msg.to} :: ${msg.subject} (${providerMessageId})`);
      return { providerMessageId };
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text }),
    });
    if (!res.ok) {
      throw new Error(`Resend send failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { id: string };
    return { providerMessageId: data.id };
  }
}
