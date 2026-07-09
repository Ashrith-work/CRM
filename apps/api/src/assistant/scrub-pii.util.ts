/**
 * Free-text PII scrubber. Before any note / free text is placed in an LLM prompt,
 * run this so email/phone/name that slipped into a body are masked. It's a
 * defense-in-depth layer ON TOP of the structural PII boundary (the AI-safe repo
 * already keeps raw PII off the customer path); this catches PII embedded in
 * free text a tool might return.
 */

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
// 7+ digits with common separators / country code — masks phone numbers.
const PHONE_RE = /\+?\d[\d\s().-]{6,}\d/g;
// Two-or-more consecutive Title-Case words → a likely person name. Conservative
// (may over-mask e.g. "New York") — over-masking is safe; leaking a name is not.
const NAME_RE = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g;

export function scrubPii(text: string): string {
  if (!text) return text;
  return text
    .replace(EMAIL_RE, '[email]')
    .replace(PHONE_RE, '[phone]')
    .replace(NAME_RE, '[name]');
}
