import { createHash } from 'node:crypto';

/**
 * PII hashing for outbound audience uploads. Meta requires each identifier to be
 * NORMALIZED (trim + lowercase; phone digits only, keep country code) then
 * SHA-256 hex-hashed before upload — the raw value never leaves our system.
 */

export function hashEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  return sha256(normalized);
}

/** Phone: strip everything non-digit (keep the country code), then hash. */
export function hashPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  return sha256(digits);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
