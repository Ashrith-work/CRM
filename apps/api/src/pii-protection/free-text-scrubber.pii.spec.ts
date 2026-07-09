import { scrubPii } from '../assistant/scrub-pii.util';
import { assertNoRawPII, type PiiFixtures } from './assert-no-raw-pii';

/**
 * TEST 4 — the free-text scrubber masks PII in notes/context before any LLM call.
 *
 * The orchestrator runs scrubPii() over tool data + the question as defense-in-
 * depth (the AI-safe repo already keeps raw PII off the path). Here we feed a
 * note body with a name + email + phone and assert each is replaced with its mask
 * token, then assertNoRawPII on the scrubbed output.
 */
const FIXTURES: PiiFixtures = {
  names: ['Priya Sharma'],
  emails: ['priya@nerige.co'],
  phones: ['+919812345678'],
};

describe('TEST 4 — free-text PII scrubber', () => {
  const NOTE = 'Called Priya Sharma at priya@nerige.co / +91 98123 45678 about her return.';

  it('masks name, email, and phone with their tokens', () => {
    const scrubbed = scrubPii(NOTE);
    expect(scrubbed).toContain('[name]');
    expect(scrubbed).toContain('[email]');
    expect(scrubbed).toContain('[phone]');
    // The raw values are gone.
    expect(scrubbed).not.toContain('Priya Sharma');
    expect(scrubbed).not.toContain('priya@nerige.co');
    expect(scrubbed).not.toContain('98123');
  });

  it('the scrubbed text passes assertNoRawPII', () => {
    assertNoRawPII(scrubPii(NOTE), FIXTURES, 'scrubbed note');
  });

  it('is idempotent-safe on already-clean text', () => {
    const clean = 'Customer #8842 is a Gold-tier VIP with 7 orders.';
    expect(scrubPii(clean)).toBe(clean);
    assertNoRawPII(scrubPii(clean), FIXTURES, 'clean text');
  });
});
