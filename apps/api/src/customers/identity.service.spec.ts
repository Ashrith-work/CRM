import { IdentityService } from './identity.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { makePii } from '../common/crypto.testkit';

const { crypto, pii } = makePii();

function customer(overrides: Record<string, unknown>) {
  return {
    id: 'x',
    organizationId: 'org1',
    externalId: null,
    email: null,
    phone: null,
    firstName: null,
    lastName: null,
    emailHash: null,
    phoneHash: null,
    emailDomain: null,
    mergedIntoId: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null,
    ...overrides,
  };
}

function build(findMany: unknown[]) {
  const create = jest.fn().mockResolvedValue(customer({ id: 'c_new' }));
  const update = jest.fn().mockImplementation(({ data }) => customer({ id: 'guest', ...data }));
  const $transaction = jest.fn().mockResolvedValue([{ count: 3 }, { count: 1 }, { count: 5 }, customer({ id: 'acct', mergedIntoId: 'guest', email: null })]);
  const prisma = {
    customer: {
      findMany: jest.fn().mockResolvedValue(findMany),
      findUnique: jest.fn().mockResolvedValue(null),
      create,
      update,
    },
    order: { updateMany: jest.fn() },
    cart: { updateMany: jest.fn() },
    commerceEvent: { updateMany: jest.fn() },
    $transaction,
  } as unknown as PrismaService;
  const record = jest.fn().mockResolvedValue(undefined);
  const service = new IdentityService(prisma, { record } as unknown as AuditService, pii);
  return { service, create, update, $transaction, record };
}

describe('IdentityService.resolveCustomer', () => {
  it('creates a new customer when nothing matches — PII encrypted, matched by hash', async () => {
    const { service, create } = build([]);
    const id = await service.resolveCustomer('org1', { externalId: '7', email: '  A@B.com ', phone: '09876543210' });
    expect(id).toBe('c_new');
    const data = create.mock.calls[0][0].data;
    // externalId + deterministic match-hashes + non-PII domain are stored plainly.
    expect(data.externalId).toBe('7');
    expect(data.emailHash).toBe(pii.emailHashOf('a@b.com'));
    expect(data.phoneHash).toBe(pii.phoneHashOf('+919876543210'));
    expect(data.emailDomain).toBe('b.com');
    // The stored email/phone are CIPHERTEXT (not the normalized plaintext)…
    expect(data.email).not.toBe('a@b.com');
    expect(crypto.isEncrypted(data.email)).toBe(true);
    // …and decrypt back to the normalized values.
    expect(crypto.decryptField(data.email)).toBe('a@b.com');
    expect(crypto.decryptField(data.phone)).toBe('+919876543210');
  });

  it('guest (email only) + later account (same email) → ONE customer, externalId filled', async () => {
    // The guest already exists, matched by email hash; the account carries externalId 7.
    const guest = customer({ id: 'guest', email: crypto.encryptField('x@y.com'), emailHash: pii.emailHashOf('x@y.com'), emailDomain: 'y.com', createdAt: new Date('2026-01-01') });
    const { service, create, update } = build([guest]);

    const id = await service.resolveCustomer('org1', { externalId: '7', email: 'x@y.com', firstName: 'Jane' });

    expect(id).toBe('guest'); // same person, not a new row
    expect(create).not.toHaveBeenCalled();
    const call = update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'guest' });
    expect(call.data.externalId).toBe('7');
    // firstName is filled but stored ENCRYPTED — decrypts back to 'Jane'.
    expect(crypto.decryptField(call.data.firstName)).toBe('Jane');
    // email already present (hash set) → not overwritten.
    expect(call.data.email).toBeUndefined();
  });

  it('two distinct matches (email vs externalId) → merged into one survivor, data re-attributed', async () => {
    const guest = customer({ id: 'guest', email: crypto.encryptField('x@y.com'), emailHash: pii.emailHashOf('x@y.com'), emailDomain: 'y.com', createdAt: new Date('2026-01-01') });
    const account = customer({ id: 'acct', externalId: '7', createdAt: new Date('2026-02-01') });
    const { service, $transaction, record } = build([guest, account]);

    const id = await service.resolveCustomer('org1', { externalId: '7', email: 'x@y.com' });

    expect(id).toBe('guest'); // earliest-created survivor
    // Merge ran in one transaction (orders/carts/events re-attributed + row pointered).
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'customer.merge', entityId: 'acct' }));
  });
});
