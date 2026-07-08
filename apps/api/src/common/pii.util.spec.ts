import { canSeeUnmaskedPii, maskContact, maskEmail, maskPhone } from './pii.util';
import { PERMISSIONS } from '@crm/types';

describe('PII masking', () => {
  it('masks email keeping shape + tld', () => {
    expect(maskEmail('jane@nerige.co')).toBe('j•••@n•••.co');
    expect(maskEmail('a@b.com')).toBe('•@b•••.com');
    expect(maskEmail(null)).toBeNull();
  });

  it('masks phone keeping the last 4', () => {
    expect(maskPhone('+919876543210')).toBe('•••••••3210');
    expect(maskPhone(null)).toBeNull();
  });

  it('canSeeUnmaskedPii only with pii:read', () => {
    expect(canSeeUnmaskedPii([PERMISSIONS.PII_READ])).toBe(true);
    expect(canSeeUnmaskedPii([PERMISSIONS.COMMERCE_READ])).toBe(false);
  });

  it('maskContact leaves values raw when unmasked, masks otherwise', () => {
    const raw = { email: 'jane@nerige.co', phone: '+919876543210' };
    expect(maskContact(raw, true)).toEqual(raw);
    expect(maskContact(raw, false)).toEqual({ email: 'j•••@n•••.co', phone: '•••••••3210' });
  });
});
