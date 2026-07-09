import { createHmac } from 'node:crypto';
import { ExotelService } from './exotel.service';

function svc(config: Record<string, unknown>) {
  return new ExotelService({ get: (k: string) => config[k] } as never);
}

describe('ExotelService (TelephonyProvider adapter)', () => {
  it('reports MOCK mode when credentials are missing', () => {
    expect(svc({}).isMock()).toBe(true);
    expect(svc({ EXOTEL_API_TOKEN: 't', EXOTEL_ACCOUNT_SID: 'sid' }).isMock()).toBe(false);
  });

  it('click-to-call returns a synthetic id in MOCK mode (no real dialing)', async () => {
    const res = await svc({}).clickToCall({ agentNumber: '+91900', customerNumber: '+91800' });
    expect(res.externalCallId).toMatch(/^mock_/);
  });

  it('parses an Exotel status callback into the normalized event', () => {
    const s = svc({ EXOTEL_ACCOUNT_SID: 'sid123' });
    const event = s.parseEvent({
      CallSid: 'exo-abc',
      Direction: 'inbound',
      Status: 'completed',
      From: '+919876543210',
      To: '+911140001234',
      RecordingUrl: 'https://rec.exotel/r.mp3',
      StartTime: '2026-07-01 10:00:00',
      EndTime: '2026-07-01 10:03:00',
      ConversationDuration: '175',
    });
    expect(event.externalCallId).toBe('exo-abc');
    expect(event.companyId).toBe('sid123'); // from config → maps to Organization.exotelAccountSid
    expect(event.direction).toBe('INBOUND');
    expect(event.status).toBe('COMPLETED');
    expect(event.fromNumber).toBe('+919876543210');
    expect(event.durationSeconds).toBe(175);
    expect(event.recordingUrl).toBe('https://rec.exotel/r.mp3');
  });

  it('verifySignature is dev-lenient without a secret, strict with one', () => {
    expect(svc({}).verifySignature('body', undefined)).toBe(true); // no secret → dev
    const s = svc({ EXOTEL_WEBHOOK_SECRET: 'shh' });
    const good = createHmac('sha256', 'shh').update('body').digest('hex');
    expect(s.verifySignature('body', good)).toBe(true);
    expect(s.verifySignature('body', 'deadbeef')).toBe(false);
    expect(s.verifySignature('body', undefined)).toBe(false);
  });

  it('exposes its id + caller id', () => {
    expect(svc({ EXOTEL_CALLER_ID: '+911140001234' }).id).toBe('exotel');
    expect(svc({ EXOTEL_CALLER_ID: '+911140001234' }).callerId()).toBe('+911140001234');
  });
});
