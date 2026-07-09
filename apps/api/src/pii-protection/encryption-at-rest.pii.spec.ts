import { makePii } from '../common/crypto.testkit';
import { assertNoRawPII, type PiiFixtures } from './assert-no-raw-pii';

/**
 * TEST 6 — PII is encrypted at rest.
 *
 * `CustomerPiiService.protect()` produces EXACTLY the values written to the
 * Customer row's email/phone/firstName/lastName columns. So the "raw DB row" is
 * that object. We assert those stored bytes are ciphertext (assertNoRawPII on the
 * stored form passes), and that the app's decrypt path (`reveal`) returns the
 * correct plaintext for an authorized read — while reading the column directly
 * (bypassing decrypt) yields only ciphertext.
 */
const FIXTURES: PiiFixtures = {
  emails: ['jane@nerige.co'],
  phones: ['+919876543210'],
  names: ['Jane Doe'],
};

describe('TEST 6 — encryption at rest', () => {
  const { crypto, pii } = makePii();

  // What the app persists — this IS the raw DB row (ciphertext columns + non-PII
  // match-hashes + email domain).
  const storedRow = pii.protect({ email: 'jane@nerige.co', phone: '+919876543210', firstName: 'Jane', lastName: 'Doe' });

  it('the stored row is ciphertext — reading columns directly reveals no PII', () => {
    // Raw column reads (bypassing the decrypt layer) are ciphertext.
    expect(crypto.isEncrypted(storedRow.email)).toBe(true);
    expect(crypto.isEncrypted(storedRow.phone)).toBe(true);
    expect(crypto.isEncrypted(storedRow.firstName)).toBe(true);
    expect(crypto.isEncrypted(storedRow.lastName)).toBe(true);

    // The stored form carries no raw PII at all (name/email/phone).
    assertNoRawPII(
      {
        email: storedRow.email,
        phone: storedRow.phone,
        firstName: storedRow.firstName,
        lastName: storedRow.lastName,
        emailHash: storedRow.emailHash,
        phoneHash: storedRow.phoneHash,
        emailDomain: storedRow.emailDomain, // domain is non-identifying, allowed
      },
      FIXTURES,
      'raw Customer DB row',
    );
  });

  it('match-hashes are HMACs, not the raw values', () => {
    expect(storedRow.emailHash).toMatch(/^[a-f0-9]{64}$/);
    expect(storedRow.emailHash).not.toContain('jane');
    expect(storedRow.emailDomain).toBe('nerige.co'); // only the domain is retained in the clear
  });

  it('the authorized decrypt path returns the correct plaintext', () => {
    const revealed = pii.reveal(storedRow);
    expect(revealed.email).toBe('jane@nerige.co');
    expect(revealed.phone).toBe('+919876543210');
    expect(revealed.firstName).toBe('Jane');
    expect(revealed.lastName).toBe('Doe');
  });
});
