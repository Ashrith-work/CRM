import { scrubPii } from './scrub-pii.util';

/**
 * Defense-in-depth: even though the AI-safe repository keeps structured PII off
 * the prompt, free text (notes, tool strings) could still embed an email/phone/
 * name. scrubPii masks those before the text reaches an LLM.
 */
describe('scrubPii', () => {
  it('masks emails', () => {
    expect(scrubPii('reach jane@nerige.co please')).toBe('reach [email] please');
  });

  it('masks phone numbers (with or without country code)', () => {
    expect(scrubPii('call +91 98765 43210 today')).toBe('call [phone] today');
    expect(scrubPii('number 9876543210')).toBe('number [phone]');
  });

  it('masks Title-Case person names', () => {
    expect(scrubPii('spoke with Jane Doe about the order')).toBe('spoke with [name] about the order');
  });

  it('masks several PII kinds in one pass', () => {
    const out = scrubPii('Priya Sharma (priya@shop.in, +919000000001) is unhappy');
    expect(out).not.toContain('priya@shop.in');
    expect(out).not.toContain('Priya Sharma');
    expect(out).not.toContain('919000000001');
    expect(out).toContain('[email]');
    expect(out).toContain('[name]');
    expect(out).toContain('[phone]');
  });

  it('leaves PII-free text unchanged', () => {
    expect(scrubPii('net revenue rose 12% in June')).toBe('net revenue rose 12% in June');
  });

  it('handles empty/falsey input', () => {
    expect(scrubPii('')).toBe('');
  });
});
