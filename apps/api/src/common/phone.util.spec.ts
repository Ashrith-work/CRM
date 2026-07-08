import { matchContactByNumber, nationalNumber, normalizeE164, type ContactCandidate } from './phone.util';

describe('normalizeE164 (default +91)', () => {
  it('adds the country code to a bare 10-digit national number', () => {
    expect(normalizeE164('9876543210')).toBe('+919876543210');
    expect(normalizeE164('98765 43210')).toBe('+919876543210'); // formatting stripped
  });
  it('strips a national trunk 0 and IDD 00', () => {
    expect(normalizeE164('09876543210')).toBe('+919876543210');
    expect(normalizeE164('00919876543210')).toBe('+919876543210');
  });
  it('preserves an explicit + prefix', () => {
    expect(normalizeE164('+91 98765 43210')).toBe('+919876543210');
    expect(normalizeE164('+1 (415) 555-2671')).toBe('+14155552671');
  });
  it('returns null for empty input', () => {
    expect(normalizeE164('')).toBeNull();
    expect(normalizeE164(null)).toBeNull();
  });
  it('nationalNumber returns the last 10 digits', () => {
    expect(nationalNumber('+919876543210')).toBe('9876543210');
  });
});

describe('matchContactByNumber (number → contact)', () => {
  const c = (id: string, phone: string | null, updatedAt: string): ContactCandidate => ({ id, phone, updatedAt: new Date(updatedAt) });

  it('no match → null, not ambiguous', () => {
    expect(matchContactByNumber([c('a', '+919999999999', '2026-01-01')], '+919876543210')).toEqual({
      contactId: null,
      ambiguous: false,
    });
  });

  it('single match (ignoring formatting) → that contact', () => {
    expect(
      matchContactByNumber([c('a', '098765 43210', '2026-01-01'), c('b', '+911111111111', '2026-01-01')], '+919876543210'),
    ).toEqual({ contactId: 'a', ambiguous: false });
  });

  it('multiple matches → most-recently-updated + ambiguous', () => {
    const result = matchContactByNumber(
      [c('old', '9876543210', '2026-01-01'), c('new', '+919876543210', '2026-06-01')],
      '+919876543210',
    );
    expect(result).toEqual({ contactId: 'new', ambiguous: true });
  });
});
