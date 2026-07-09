import { AudienceService, type ConsentedMember } from '../audiences/audience.service';
import { hashEmail, hashPhone } from '../common/hash.util';
import { assertNoRawPII, type PiiFixtures } from './assert-no-raw-pii';

/**
 * TEST 5 — external API payloads carry no raw PII (except where a service
 * legitimately needs it, which we assert differently).
 *
 *  • Meta audience upload → emails/phones are SHA-256 HASHED before they leave
 *    us; assertNoRawPII passes on the built payload; raw values are absent.
 *  • LLM API → covered by assistant-llm-payload.pii.spec.ts (same detector).
 *  • Resend email legitimately needs the recipient address, so we do NOT assert
 *    PII-absence there; instead the audience upload is ConsentGate-gated upstream
 *    (resolveConsentedMembers), and only identifiable rows are ever built.
 */
const FIXTURES: PiiFixtures = {
  emails: ['jane@nerige.co'],
  phones: ['+919876543210'],
  names: ['Jane Doe'],
};

// buildPayload only uses the hash utils — no injected deps are touched.
function svc(): AudienceService {
  return new AudienceService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
}

const MEMBERS: ConsentedMember[] = [
  { customerId: 'c1', email: 'jane@nerige.co', phone: '+919876543210' },
  { customerId: 'c2', email: 'Ravi@nerige.co', phone: null },
];

describe('TEST 5 — external payloads: Meta audience upload is hashed', () => {
  it('uses Meta’s SHA-256 schema', () => {
    const payload = svc().buildPayload(MEMBERS);
    expect(payload.schema).toEqual(['EMAIL_SHA256', 'PHONE_SHA256']);
  });

  it('hashes every identifier — no raw email/phone in the payload', () => {
    const payload = svc().buildPayload(MEMBERS);

    // The raw form carries no raw PII (hashes are skipped by the detector).
    assertNoRawPII(payload, FIXTURES, 'Meta audience payload');

    // Each cell is a SHA-256 hex digest (or empty), matching the real hash.
    expect(payload.data[0][0]).toBe(hashEmail('jane@nerige.co'));
    expect(payload.data[0][1]).toBe(hashPhone('+919876543210'));
    expect(payload.data[0][0]).toMatch(/^[a-f0-9]{64}$/);

    // No address, no local-part, no raw number anywhere in the serialized upload.
    const blob = JSON.stringify(payload);
    expect(blob).not.toContain('@');
    expect(blob).not.toContain('jane');
    expect(blob).not.toContain('9876543210');
  });

  it('normalizes before hashing (case-insensitive email match)', () => {
    const payload = svc().buildPayload([{ customerId: 'c2', email: 'Ravi@nerige.co', phone: null }]);
    expect(payload.data[0][0]).toBe(hashEmail('ravi@nerige.co'));
    expect(payload.data[0][1]).toBe(''); // no phone → empty slot, never a raw value
  });

  it('drops rows with no identifier (nothing to match on leaves us)', () => {
    const payload = svc().buildPayload([{ customerId: 'c3', email: null, phone: null }]);
    expect(payload.data).toHaveLength(0);
  });
});
