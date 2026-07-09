import { Customer360Service } from '../customers/customer360.service';
import { makePii } from '../common/crypto.testkit';
import { maskEmail, maskPhone } from '../common/pii.util';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';

/**
 * TEST 7 — raw-PII access is AUDITED.
 * TEST 8 — RBAC masking: non-admin gets masked contact, admin gets decrypted;
 *          the decrypted (unmasked) read is audited.
 *
 * Both exercise the real Customer360Service.get360 with a real CustomerPiiService
 * (encrypted fixture row) and a mocked AuditService/Prisma/Redis.
 *
 * NOTE (assumption to confirm): get360 masks the regulated CONTACT channels
 * (email + phone) by role, but returns the display name (firstName/lastName)
 * decrypted to every role — a deliberate CRM usability carve-out, not a bug. If
 * the display name must also be masked for non-admins, that protection is not
 * built and this suite should be extended to assert it.
 */
function build() {
  const { pii } = makePii();
  const stored = pii.protect({ email: 'jane@nerige.co', phone: '+919876543210', firstName: 'Jane', lastName: 'Doe' });
  const customerRow = {
    id: 'c1',
    externalId: 'ext_1',
    email: stored.email,
    phone: stored.phone,
    firstName: stored.firstName,
    lastName: stored.lastName,
    mergedIntoId: null,
  };
  const prisma = {
    customer: { findFirst: jest.fn().mockResolvedValue(customerRow) },
    customerFeatures: { findUnique: jest.fn().mockResolvedValue(null) },
  } as unknown as PrismaService;
  const redis = {
    cacheGet: jest.fn().mockResolvedValue(null),
    cacheSet: jest.fn().mockResolvedValue(undefined),
  } as unknown as RedisService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const svc = new Customer360Service(prisma, redis, pii, audit as never);
  return { svc, audit };
}

describe('TEST 7 — raw-PII access is audited', () => {
  it('an authorized decrypted (unmasked) read writes an AuditLog row', async () => {
    const { svc, audit } = build();
    await svc.get360('org1', 'c1', true, 'admin_user');

    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org1',
        actorUserId: 'admin_user',
        action: 'customer.pii.reveal',
        entity: 'Customer',
        entityId: 'c1',
      }),
    );
  });

  it('a masked read does NOT decrypt-audit (no raw PII was accessed)', async () => {
    const { svc, audit } = build();
    await svc.get360('org1', 'c1', false);
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('TEST 8 — RBAC masking of contact channels', () => {
  it('admin (unmasked) sees decrypted email + phone, and it is audited', async () => {
    const { svc, audit } = build();
    const profile = await svc.get360('org1', 'c1', true, 'admin_user');

    expect(profile.email).toBe('jane@nerige.co');
    expect(profile.phone).toBe('+919876543210');
    expect(profile.masked).toBe(false);
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('non-admin (masked) sees masked email + phone', async () => {
    const { svc } = build();
    const profile = await svc.get360('org1', 'c1', false);

    expect(profile.email).toBe(maskEmail('jane@nerige.co'));
    expect(profile.phone).toBe(maskPhone('+919876543210'));
    expect(profile.masked).toBe(true);
    // The unmasked address/number never appear in the masked profile.
    expect(profile.email).not.toBe('jane@nerige.co');
    expect(profile.phone).not.toBe('+919876543210');
  });
});
