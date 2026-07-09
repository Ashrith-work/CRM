import { assertNoRawPII } from './assert-no-raw-pii';

/**
 * Guard-the-guard: a PII detector that silently passes everything is worse than
 * none. These prove assertNoRawPII (a) FAILS on real PII and (b) does NOT cry
 * wolf on the safe shapes the rest of the suite relies on (pseudonyms, email
 * domains, SHA-256 hashes, masked contact, money in minor units).
 */
const FIXTURES = { emails: ['jane@nerige.co'], phones: ['+919876543210'], names: ['Jane Doe'] };

describe('assertNoRawPII (the detector itself)', () => {
  describe('FAILS on raw PII', () => {
    it('catches a raw email — by regex and by fixture', () => {
      expect(() => assertNoRawPII({ note: 'reach me at jane@nerige.co' }, FIXTURES)).toThrow(/email/i);
    });

    it('catches an E.164 / +91 phone', () => {
      expect(() => assertNoRawPII({ phone: '+91 98765 43210' }, FIXTURES)).toThrow(/phone/i);
    });

    it('catches a bare 10-digit Indian mobile', () => {
      expect(() => assertNoRawPII({ contact: 'call 9876543210' })).toThrow(/phone/i);
    });

    it('catches a fixture name embedded in free text', () => {
      expect(() => assertNoRawPII({ summary: 'spoke with Jane Doe today' }, FIXTURES)).toThrow(/name/i);
    });

    it('finds PII nested deep in arrays/objects and names the path', () => {
      const payload = { messages: [{ role: 'user', content: [{ text: 'email jane@nerige.co' }] }] };
      expect(() => assertNoRawPII(payload, FIXTURES, 'llm')).toThrow(/llm\.messages\[0\]\.content\[0\]\.text/);
    });
  });

  describe('PASSES on safe, non-identifying shapes', () => {
    it('allows a pseudonym + email domain + RFM + tier', () => {
      const safe = { pseudonym: 'Customer #8842', emailDomain: 'nerige.co', rfmSegment: 'Loyal', vipTier: 'Gold' };
      expect(() => assertNoRawPII(safe, FIXTURES)).not.toThrow();
    });

    it('allows a SHA-256 hash (Meta upload cell)', () => {
      // sha256("jane@nerige.co") — a hashed identifier is not raw PII.
      const hash = 'a'.repeat(64); // any 64-hex string is treated as hashed
      expect(() => assertNoRawPII({ schema: ['EMAIL_SHA256'], data: [[hash, '']] }, FIXTURES)).not.toThrow();
    });

    it('allows masked contact (j•••@n•••.co / •••••••3210)', () => {
      expect(() => assertNoRawPII({ email: 'j•••@n•••.co', phone: '•••••••3210' }, FIXTURES)).not.toThrow();
    });

    it('does not mistake large money-in-minor-units for a phone', () => {
      expect(() => assertNoRawPII({ netRevenueMinor: 100000000, orderCount: 42 })).not.toThrow();
    });
  });
});
