import type { CallDirection, CallStatus } from '@crm/types';

/** DI token for the ACTIVE telephony provider (selected by TELEPHONY_PROVIDER). */
export const TELEPHONY_PROVIDER = Symbol('TELEPHONY_PROVIDER');

export type TelephonyProviderId = 'myoperator' | 'exotel';

export interface ClickToCallParams {
  agentNumber: string;
  customerNumber: string;
}

/** A provider webhook mapped to our normalized, provider-neutral call event. */
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
 * The swap-able telephony provider seam. Each adapter (MyOperator, Exotel)
 * isolates ALL provider specifics behind these methods + the normalized shapes
 * above; the calls/recording code is provider-agnostic. Which adapter is the
 * ACTIVE one (for outbound + recording download) is chosen by TELEPHONY_PROVIDER;
 * each provider's webhook route parses with its own adapter.
 */
export interface TelephonyProvider {
  readonly id: TelephonyProviderId;
  /** True when the provider has no credentials → MOCK (no real dialing). */
  isMock(): boolean;
  /** The org's caller-id / DID for outbound (null if unset). */
  callerId(): string | null;
  /** Initiate an outbound call bridging the agent to the customer. */
  clickToCall(params: ClickToCallParams): Promise<{ externalCallId: string }>;
  /** Verify webhook authenticity (HMAC/secret). True when no secret is set (dev). */
  verifySignature(rawBody: string, signature: string | undefined): boolean;
  webhookSecretConfigured(): boolean;
  /** Map a raw provider webhook payload to the normalized event. */
  parseEvent(payload: unknown): NormalizedCallEvent;
  /** Download a recording; the caller enforces the size guard. */
  downloadRecording(url: string): Promise<DownloadedRecording>;
}

export type { CallDirection, CallStatus };
