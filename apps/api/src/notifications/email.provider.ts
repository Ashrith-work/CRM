import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Email channel adapter. If RESEND_API_KEY is set, sends via the Resend HTTP API
 * (no SDK — plain fetch); otherwise logs the email so local/dev runs still prove
 * the fan-out path. Swapping in SES/Postmark/etc. is a one-method change.
 *
 * Throws on failure so the caller can decide whether the channel was delivered.
 */
@Injectable()
export class EmailProvider {
  private readonly logger = new Logger(EmailProvider.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  async send(message: EmailMessage): Promise<void> {
    const apiKey = this.config.get('RESEND_API_KEY', { infer: true });
    const from = this.config.get('EMAIL_FROM', { infer: true });

    if (!apiKey) {
      this.logger.log(`[email:log] to=${message.to} subject="${message.subject}"`);
      return;
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: message.to, subject: message.subject, text: message.text }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Resend send failed: ${res.status} ${detail}`);
    }
  }
}
