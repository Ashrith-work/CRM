import { makePii } from '../common/crypto.testkit';
import { domainOf } from './customer-pii.service';

/**
 * The PII gate: protect() encrypts name/email/phone + derives deterministic
 * match-hashes + the non-PII domain; reveal() decrypts. The hashes are stable
 * (so identity/dedup can match) while the ciphertext is not (so it's safe at
 * rest). Normalization (trim/lowercase email, E.164 phone) happens before both.
 */
describe('CustomerPiiService.protect / reveal', () => {
  it('encrypts PII, derives deterministic hashes + domain, and round-trips on reveal', () => {
    const { crypto, pii } = makePii();
    const p = pii.protect({ email: '  Jane@Nerige.CO ', phone: '09876543210', firstName: 'Jane', lastName: 'Doe' });

    // Stored PII is ciphertext.
    expect(crypto.isEncrypted(p.email)).toBe(true);
    expect(crypto.isEncrypted(p.phone)).toBe(true);
    expect(crypto.isEncrypted(p.firstName)).toBe(true);

    // Non-PII, cleartext helpers.
    expect(p.emailDomain).toBe('nerige.co');
    expect(p.emailHash).toBe(pii.emailHashOf('jane@nerige.co'));
    expect(p.phoneHash).toBe(pii.phoneHashOf('+919876543210'));

    // reveal decrypts back to the NORMALIZED values.
    const r = pii.reveal(p);
    expect(r.email).toBe('jane@nerige.co');
    expect(r.phone).toBe('+919876543210');
    expect(r.firstName).toBe('Jane');
    expect(r.lastName).toBe('Doe');
  });

  it('match-hashes are deterministic and normalization-insensitive; ciphertext is not', () => {
    const { pii } = makePii();
    // Different casing/spacing → SAME hash (so dedup matches).
    expect(pii.emailHashOf('  A@B.com')).toBe(pii.emailHashOf('a@b.com'));
    // Two encryptions of the same email differ (non-deterministic GCM).
    expect(pii.protect({ email: 'a@b.com' }).email).not.toBe(pii.protect({ email: 'a@b.com' }).email);
  });

  it('the pepper matters — a different pepper yields a different hash', () => {
    const a = makePii({ HASH_PEPPER: 'pepper-a' }).pii;
    const b = makePii({ HASH_PEPPER: 'pepper-b' }).pii;
    expect(a.emailHashOf('x@y.co')).not.toBe(b.emailHashOf('x@y.co'));
  });

  it('null identifiers produce null hashes/ciphertext (no phantom rows)', () => {
    const { pii } = makePii();
    const p = pii.protect({ email: null, phone: null, firstName: null, lastName: null });
    expect(p.email).toBeNull();
    expect(p.emailHash).toBeNull();
    expect(p.phoneHash).toBeNull();
    expect(p.emailDomain).toBeNull();
  });

  it('revealName joins decrypted first/last', () => {
    const { pii } = makePii();
    const p = pii.protect({ firstName: 'Amit', lastName: 'Sharma' });
    expect(pii.revealName(p)).toBe('Amit Sharma');
  });

  it('domainOf extracts the domain (non-PII)', () => {
    expect(domainOf('jane@gmail.com')).toBe('gmail.com');
    expect(domainOf(null)).toBeNull();
    expect(domainOf('no-at-sign')).toBeNull();
  });
});
