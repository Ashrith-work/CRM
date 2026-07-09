/**
 * assertNoRawPII — the shared PII detector used by the pii-protection suite.
 *
 * It walks any string/array/object and FAILS (throws) if it finds raw customer
 * PII: an email address, a phone number (E.164 or a bare Indian mobile), or the
 * exact name/email/phone values of the test fixtures. It is framework-free (no
 * jest import) so it can be reused by any spec and compiled into the app build
 * alongside `crypto.testkit.ts`.
 *
 * Design notes that keep it from BOTH missing leaks and crying wolf:
 *  - It inspects each STRING LEAF individually (not one giant JSON blob), so a
 *    field boundary can't accidentally splice two safe values into a match.
 *  - A leaf that is a full SHA-256 hex digest is SKIPPED — Meta uploads are
 *    hashed, and hashed is the whole point; a hash is not raw PII.
 *  - The phone matcher is deliberately targeted (leading "+", or a 10-digit
 *    6–9-leading Indian mobile bounded by non-digits) so 8+ digit money/ID
 *    numbers are not mistaken for phones. The fixture-exact check is the
 *    backstop for anything shaped unusually.
 */

export interface PiiFixtures {
  /** Exact email values seeded in the test (matched case-insensitively). */
  emails?: string[];
  /** Exact phone values seeded in the test (matched on their digits). */
  phones?: string[];
  /** Exact person names seeded in the test (matched case-insensitively). */
  names?: string[];
}

// An email anywhere in the string.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
// E.164 / internationally-formatted: MUST start with "+" so long money/id
// numbers (which never carry a leading +) don't register as phones.
const PHONE_PLUS_RE = /\+\d[\d\s().-]{6,}\d/;
// A bare Indian mobile: exactly 10 digits, 6–9 leading, not part of a longer run.
const INDIAN_MOBILE_RE = /(?<!\d)[6-9]\d{9}(?!\d)/;
// A full SHA-256 digest (what leaves us for Meta) — already hashed, not raw.
const SHA256_RE = /^[a-f0-9]{64}$/i;

function digitsOf(s: string): string {
  return s.replace(/\D/g, '');
}

function uniq(arr: string[]): string[] {
  return [...new Set(arr)];
}

/**
 * Throw if `payload` contains raw PII. Pass `fixtures` with the exact values the
 * test seeded so the check catches them even in an unusual shape. `label` names
 * the payload in the error (e.g. "LLM composer call").
 */
export function assertNoRawPII(payload: unknown, fixtures: PiiFixtures = {}, label = 'payload'): void {
  const leaks: string[] = [];
  const fxEmails = (fixtures.emails ?? []).map((e) => e.toLowerCase());
  const fxNames = (fixtures.names ?? []).map((n) => n.toLowerCase());
  const fxPhones = (fixtures.phones ?? []).map(digitsOf).filter((d) => d.length >= 7);

  const checkString = (s: string, path: string): void => {
    if (SHA256_RE.test(s.trim())) return; // hashed identifier — not raw PII
    const lower = s.toLowerCase();
    const dg = digitsOf(s);

    const email = s.match(EMAIL_RE);
    if (email) leaks.push(`${path}: email-like "${email[0]}"`);
    const phonePlus = s.match(PHONE_PLUS_RE);
    if (phonePlus) leaks.push(`${path}: phone-like "${phonePlus[0].trim()}"`);
    const mobile = s.match(INDIAN_MOBILE_RE);
    if (mobile) leaks.push(`${path}: phone-like "${mobile[0]}"`);

    for (const e of fxEmails) if (lower.includes(e)) leaks.push(`${path}: fixture email "${e}"`);
    for (const n of fxNames) if (lower.includes(n)) leaks.push(`${path}: fixture name "${n}"`);
    for (const p of fxPhones) if (dg.includes(p)) leaks.push(`${path}: fixture phone "${p}"`);
  };

  const visit = (val: unknown, path: string): void => {
    if (val === null || val === undefined) return;
    if (typeof val === 'string') return checkString(val, path);
    if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'bigint') return;
    if (Array.isArray(val)) {
      val.forEach((v, i) => visit(v, `${path}[${i}]`));
      return;
    }
    if (typeof val === 'object') {
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        visit(v, path ? `${path}.${k}` : k);
      }
    }
  };

  visit(payload, label);

  if (leaks.length > 0) {
    throw new Error(`assertNoRawPII: raw PII found in ${label}:\n  - ${uniq(leaks).join('\n  - ')}`);
  }
}
