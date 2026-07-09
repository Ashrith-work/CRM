import { AudienceService } from './audience.service';
import { hashEmail } from '../common/hash.util';
import { makePii } from '../common/crypto.testkit';

const { pii } = makePii();

/**
 * The ConsentGate is the security core of audience sync: a non-consented or
 * suppressed customer must NEVER be uploaded to Meta. These tests prove the gate
 * excludes them and that PII is hashed (never raw) before it leaves us.
 */
function build(opts: {
  members: Array<{ id: string; email: string | null; phone: string | null }>;
  eligible: (id: string) => boolean;
}) {
  const prisma = {
    segmentMembership: { findMany: jest.fn().mockResolvedValue(opts.members.map((m) => ({ customerId: m.id }))) },
    customer: { findMany: jest.fn().mockResolvedValue(opts.members) },
    segment: { findFirst: jest.fn().mockResolvedValue({ id: 'seg1', name: 'VIP' }) },
    audienceSync: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockImplementation(({ data }) => ({ id: 'as1', ...data })) },
  };
  const gate = { isEligible: jest.fn().mockImplementation(async (_org: string, id: string) => opts.eligible(id)) };
  const addUsers = jest.fn().mockResolvedValue(undefined);
  const createAudience = jest.fn().mockResolvedValue('meta_aud_1');
  const meta = { addUsers, createCustomAudience: createAudience };
  const connect = { connectionFor: jest.fn().mockResolvedValue({ adAccountId: 'act_1', businessId: null, accessToken: 't', apiVersion: 'v21.0' }) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const svc = new AudienceService(prisma as never, audit as never, gate as never, meta as never, connect as never, pii as never);
  return { svc, addUsers, createAudience, prisma, audit };
}

describe('AudienceService — ConsentGate', () => {
  const CONSENTED = { id: 'c1', email: 'yes@shop.in', phone: '+919000000001' };
  const NOT_CONSENTED = { id: 'c2', email: 'no@shop.in', phone: '+919000000002' };
  const SUPPRESSED = { id: 'c3', email: 'stop@shop.in', phone: '+919000000003' };

  it('excludes non-consented + suppressed customers and NEVER sends their PII', async () => {
    const { svc, addUsers } = build({
      members: [CONSENTED, NOT_CONSENTED, SUPPRESSED],
      eligible: (id) => id === 'c1', // only c1 is consented + not suppressed
    });

    const result = await svc.sync('org1', 'user1', { segmentId: 'seg1', type: 'custom' });

    expect(result.sizeSynced).toBe(1);
    expect(result.excludedByConsent).toBe(2);

    // The upload contains ONLY the consented customer's hashed email — never the
    // excluded customers' identifiers (hashed OR raw).
    expect(addUsers).toHaveBeenCalledTimes(1);
    const [, , , data] = addUsers.mock.calls[0];
    const uploadedEmails = (data as string[][]).map((row) => row[0]);
    expect(uploadedEmails).toContain(hashEmail(CONSENTED.email));
    expect(uploadedEmails).not.toContain(hashEmail(NOT_CONSENTED.email));
    expect(uploadedEmails).not.toContain(hashEmail(SUPPRESSED.email));
    // And absolutely no raw emails.
    for (const row of data as string[][]) {
      expect(row.join('')).not.toContain('@');
    }
  });

  it('resolveConsentedMembers counts every excluded member', async () => {
    const { svc } = build({ members: [CONSENTED, NOT_CONSENTED], eligible: (id) => id === 'c1' });
    const { members, excluded } = await svc.resolveConsentedMembers('org1', 'seg1');
    expect(members.map((m) => m.customerId)).toEqual(['c1']);
    expect(excluded).toBe(1);
  });

  it('a customer with no email is not eligible (can\'t verify suppression)', async () => {
    const { svc } = build({ members: [{ id: 'c9', email: null, phone: '+919000000009' }], eligible: () => true });
    const { members, excluded } = await svc.resolveConsentedMembers('org1', 'seg1');
    expect(members).toHaveLength(0);
    expect(excluded).toBe(1);
  });

  it('buildPayload hashes identifiers and drops rows with none', () => {
    const { svc } = build({ members: [], eligible: () => true });
    const payload = svc.buildPayload([
      { customerId: 'c1', email: 'a@b.co', phone: null },
      { customerId: 'c2', email: null, phone: null }, // dropped — nothing to match
    ]);
    expect(payload.schema).toEqual(['EMAIL_SHA256', 'PHONE_SHA256']);
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0][0]).toBe(hashEmail('a@b.co'));
  });
});
