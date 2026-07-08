/**
 * One-method channel interface so WhatsApp/SMS can slot in later (Phase 2)
 * without touching campaign logic. The engine depends only on this.
 */
export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: string;
}

export interface SendResult {
  providerMessageId: string;
}

export interface MessageChannelAdapter {
  readonly channel: 'EMAIL';
  /** Sends the message. MUST throw on provider failure so the caller can retry. */
  send(msg: OutboundEmail): Promise<SendResult>;
}

export const EMAIL_CHANNEL = Symbol('EMAIL_CHANNEL');
