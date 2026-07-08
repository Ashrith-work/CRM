import { PERMISSIONS } from '@crm/types';

/**
 * PII masking. Only callers with `pii:read` (admin/owner) see raw email/phone;
 * everyone else gets a masked form on the profile, list, and export.
 */

export function canSeeUnmaskedPii(permissions: string[]): boolean {
  return permissions.includes(PERMISSIONS.PII_READ);
}

/** jane@nerige.co → j•••@n•••.co */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [user, domain] = email.split('@');
  if (!domain) return '•••';
  const maskedUser = user.length <= 1 ? '•' : `${user[0]}•••`;
  const [host, ...tld] = domain.split('.');
  const maskedHost = `${host[0] ?? '•'}•••`;
  return tld.length ? `${maskedUser}@${maskedHost}.${tld.join('.')}` : `${maskedUser}@${maskedHost}`;
}

/** +919876543210 → •••••••3210 (last 4 kept). */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '••••';
  return `•••••••${digits.slice(-4)}`;
}

/** Apply masking to an {email, phone} pair unless the caller is unmasked. */
export function maskContact<T extends { email: string | null; phone: string | null }>(
  value: T,
  unmasked: boolean,
): T {
  if (unmasked) return value;
  return { ...value, email: maskEmail(value.email), phone: maskPhone(value.phone) };
}
