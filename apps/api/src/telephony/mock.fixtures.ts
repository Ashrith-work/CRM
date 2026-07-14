/**
 * Fixture payloads for the MOCK telephony provider. These stand in for real
 * MyOperator webhooks so the whole pipeline (verify → parse → upsert → match →
 * timeline → consent-gated recording) runs and is tested WITHOUT a real account.
 *
 * The mock's `parseEvent` maps this shape to the provider-neutral
 * NormalizedCallEvent. `companyId` maps an event to an org the same way a real
 * webhook does — set an Organization's `myoperatorCompanyId` to MOCK_COMPANY_ID
 * (see the specs) so `CallsService.resolveOrg` finds it.
 */

/** The account id fixtures carry; map it via Organization.myoperatorCompanyId. */
export const MOCK_COMPANY_ID = 'MOCK_CO';

/** A mock recording "file" — a few bytes with an ID3 header, stored to Cloudinary. */
export const MOCK_RECORDING_BYTES: readonly number[] = [
  0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x21, 0x6d, 0x6f, 0x63, 0x6b,
];

/** A mock recording URL scheme (the mock downloadRecording returns fixture bytes). */
export const mockRecordingUrl = (callId: string): string => `mock://recording/${callId}`;

/** The raw fixture shape the mock provider parses (a stand-in webhook body). */
export interface MockCallEventPayload {
  callId: string;
  companyId?: string | null;
  direction: 'inbound' | 'outbound';
  /** e.g. 'ringing' | 'answered' | 'completed' | 'missed' | 'no_answer' | 'failed'. */
  status: string;
  from: string;
  to: string;
  agent?: string;
  startTime?: string | number;
  answerTime?: string | number;
  endTime?: string | number;
  duration?: number;
  recordingUrl?: string | null;
}

/** Build a fixture event with sensible defaults; override any field. */
export function makeMockEvent(overrides: Partial<MockCallEventPayload> & Pick<MockCallEventPayload, 'callId'>): MockCallEventPayload {
  return {
    companyId: MOCK_COMPANY_ID,
    direction: 'inbound',
    status: 'completed',
    from: '+919000000001',
    to: '+911100000000',
    agent: '+911100000000',
    startTime: '2026-07-14T10:00:00Z',
    answerTime: '2026-07-14T10:00:05Z',
    endTime: '2026-07-14T10:02:05Z',
    duration: 120,
    ...overrides,
  };
}

/** Inbound, answered/completed, WITH a recording (drives the recording flow). */
export function inboundCompletedWithRecording(callId = 'mock_call_inbound_1'): MockCallEventPayload {
  return makeMockEvent({ callId, direction: 'inbound', status: 'completed', recordingUrl: mockRecordingUrl(callId) });
}

/** Outbound (click-to-call), completed, no recording. */
export function outboundCompleted(callId = 'mock_call_outbound_1'): MockCallEventPayload {
  return makeMockEvent({ callId, direction: 'outbound', status: 'completed', from: '+911100000000', to: '+919000000002', recordingUrl: null });
}

/** Inbound, missed (rings, never answered). */
export function inboundMissed(callId = 'mock_call_missed_1'): MockCallEventPayload {
  return makeMockEvent({ callId, direction: 'inbound', status: 'missed', answerTime: undefined, endTime: undefined, duration: 0, recordingUrl: null });
}

/**
 * An out-of-order pair for the SAME call: the terminal COMPLETED event arrives
 * BEFORE the RINGING event. Processing both must still yield one Call in a
 * consistent terminal state (idempotent upsert + monotonic status).
 */
export function outOfOrderPair(callId = 'mock_call_ooo_1'): [MockCallEventPayload, MockCallEventPayload] {
  const completed = makeMockEvent({ callId, direction: 'inbound', status: 'completed' });
  const ringing = makeMockEvent({ callId, direction: 'inbound', status: 'ringing', answerTime: undefined, endTime: undefined, duration: 0 });
  return [completed, ringing];
}
