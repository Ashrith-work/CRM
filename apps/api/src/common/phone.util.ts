/**
 * Phone-number normalization to E.164 and contact matching. Kept pure so the
 * number→contact rules (none / one / ambiguous) are unit-testable without a DB.
 * Default country is India (+91) — the deployment target for M5.
 */

/** Normalize a raw phone string to E.164 (e.g. "+919876543210"), or null. */
export function normalizeE164(raw: string | null | undefined, defaultCc = '91'): string | null {
  if (!raw) return null;
  const hadPlus = raw.trim().startsWith('+');
  let digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  if (hadPlus) return `+${digits}`;
  // Strip trunk/IDD prefixes: leading 0 (national) or 00 (IDD).
  digits = digits.replace(/^00/, '').replace(/^0+/, '');
  if (!digits) return null;

  // Bare 10-digit national number → prepend the default country code.
  if (digits.length === 10) return `+${defaultCc}${digits}`;
  // Already country-code-prefixed (e.g. 12 digits starting 91) → keep as is.
  return `+${digits}`;
}

/** The last (up to) 10 digits — the national number, for suffix matching. */
export function nationalNumber(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  return digits ? digits.slice(-10) : null;
}

export interface ContactCandidate {
  id: string;
  phone: string | null;
  updatedAt: Date;
}

export interface ContactMatch {
  contactId: string | null;
  /** True when more than one contact matched (most-recent was picked). */
  ambiguous: boolean;
}

/**
 * Match a normalized E.164 number to one of `candidates`:
 *  - 0 matches → { null, false }  (log against the raw number; offer to create)
 *  - 1 match   → { id, false }
 *  - >1 match  → most-recently-updated contact + ambiguous=true
 * Matching is on the national number so formatting differences don't matter.
 */
export function matchContactByNumber(candidates: ContactCandidate[], e164: string | null): ContactMatch {
  const target = nationalNumber(e164);
  if (!target) return { contactId: null, ambiguous: false };

  const matches = candidates.filter((c) => nationalNumber(c.phone) === target);
  if (matches.length === 0) return { contactId: null, ambiguous: false };
  if (matches.length === 1) return { contactId: matches[0].id, ambiguous: false };

  const mostRecent = [...matches].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  return { contactId: mostRecent.id, ambiguous: true };
}
