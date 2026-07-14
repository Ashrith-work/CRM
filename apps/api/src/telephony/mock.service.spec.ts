import { MockTelephonyService } from './mock.service';
import { inboundCompletedWithRecording, inboundMissed, makeMockEvent, MOCK_COMPANY_ID } from './mock.fixtures';

function svc(config: Record<string, unknown> = { MOCK_WEBHOOK_SECRET: 'mock-webhook-secret', MOCK_CALLER_ID: '+911100000000' }) {
  return new MockTelephonyService({ get: (k: string) => config[k] } as never);
}

describe('MockTelephonyService (TelephonyProvider adapter)', () => {
  it('is always mock and exposes its id + caller id', () => {
    const s = svc();
    expect(s.isMock()).toBe(true);
    expect(s.id).toBe('mock');
    expect(s.callerId()).toBe('+911100000000');
  });

  it('click-to-call returns a synthetic mock id (no real dialing)', async () => {
    const res = await svc().clickToCall({ agentNumber: '+911100000000', customerNumber: '+919000000001' });
    expect(res.externalCallId).toMatch(/^mock_/);
  });

  it('verifySignature: valid signature passes, tampered/missing fails', () => {
    const s = svc();
    const body = JSON.stringify(inboundCompletedWithRecording());
    const good = s.sign(body);
    expect(s.verifySignature(body, good)).toBe(true);
    expect(s.verifySignature(body, 'deadbeef')).toBe(false);
    expect(s.verifySignature(body, undefined)).toBe(false);
    // Tampering with the body invalidates the (unchanged) signature.
    expect(s.verifySignature(body + 'x', good)).toBe(false);
  });

  it('verifySignature is dev-lenient only when no secret is configured', () => {
    expect(svc({}).verifySignature('body', undefined)).toBe(true);
  });

  it('parses a fixture into the normalized event (inbound, completed, with recording)', () => {
    const event = svc().parseEvent(inboundCompletedWithRecording('mock_x'));
    expect(event.externalCallId).toBe('mock_x');
    expect(event.companyId).toBe(MOCK_COMPANY_ID);
    expect(event.direction).toBe('INBOUND');
    expect(event.status).toBe('COMPLETED');
    expect(event.fromNumber).toBe('+919000000001');
    expect(event.durationSeconds).toBe(120);
    expect(event.recordingUrl).toBe('mock://recording/mock_x');
  });

  it('parses an outbound + a missed fixture correctly', () => {
    const out = svc().parseEvent(makeMockEvent({ callId: 'o1', direction: 'outbound', status: 'completed' }));
    expect(out.direction).toBe('OUTBOUND');
    const missed = svc().parseEvent(inboundMissed('m1'));
    expect(missed.status).toBe('MISSED');
    expect(missed.recordingUrl).toBeNull();
  });

  it('downloadRecording returns a fixture buffer (no network)', async () => {
    const dl = await svc().downloadRecording('mock://recording/mock_x');
    expect(dl.sizeBytes).toBeGreaterThan(0);
    expect(dl.buffer.byteLength).toBe(dl.sizeBytes);
    expect(dl.contentType).toBe('audio/mpeg');
  });

  it('fetchRecentCalls returns staged calls at/after `since` (simulates missed webhooks)', async () => {
    const s = svc();
    expect(await s.fetchRecentCalls(new Date(0))).toEqual([]);
    s.stageRecentCall(makeMockEvent({ callId: 'r1', startTime: '2026-07-14T10:00:00Z' }));
    s.stageRecentCall(makeMockEvent({ callId: 'r2', startTime: '2026-07-14T09:00:00Z' }));
    const recent = await s.fetchRecentCalls(new Date('2026-07-14T09:30:00Z'));
    expect(recent.map((e) => e.externalCallId)).toEqual(['r1']);
    s.resetRecentCalls();
    expect(await s.fetchRecentCalls(new Date(0))).toEqual([]);
  });

  it('healthCheck reports up', async () => {
    expect(await svc().healthCheck()).toBe('up');
  });
});
