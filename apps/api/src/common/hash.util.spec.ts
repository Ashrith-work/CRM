import { hashEmail, hashPhone } from './hash.util';

describe('PII hashing (Meta audience upload)', () => {
  it('hashes email SHA-256 hex after normalizing case + whitespace', () => {
    const a = hashEmail('  Jane@Nerige.CO ');
    const b = hashEmail('jane@nerige.co');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes phone as digits-only (keeps country code)', () => {
    const a = hashPhone('+91 98765-43210');
    const b = hashPhone('919876543210');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns null for missing/empty identifiers (never hashes nothing)', () => {
    expect(hashEmail(null)).toBeNull();
    expect(hashEmail('')).toBeNull();
    expect(hashPhone(undefined)).toBeNull();
    expect(hashPhone('---')).toBeNull();
  });

  it('never returns the raw value', () => {
    expect(hashEmail('jane@nerige.co')).not.toContain('jane');
  });
});
