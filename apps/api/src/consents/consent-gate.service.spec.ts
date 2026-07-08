import { ConsentGate } from './consent-gate.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';

function build(consent: { status: string } | null) {
  const record = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    consent: { findFirst: jest.fn().mockResolvedValue(consent) },
  } as unknown as PrismaService;
  const audit = { record } as unknown as AuditService;
  return { gate: new ConsentGate(prisma, audit), record };
}

describe('ConsentGate.ensureCanStore', () => {
  it('allows and does NOT audit when consent is GRANTED', async () => {
    const { gate, record } = build({ status: 'GRANTED' });
    await expect(gate.ensureCanStore('org1', 'c1', 'call1', 'u1')).resolves.toBe(true);
    expect(record).not.toHaveBeenCalled();
  });

  it('blocks + audits when consent is WITHDRAWN', async () => {
    const { gate, record } = build({ status: 'WITHDRAWN' });
    await expect(gate.ensureCanStore('org1', 'c1', 'call1', 'u1')).resolves.toBe(false);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'recording.blocked', entity: 'Call', entityId: 'call1' }),
    );
  });

  it('blocks + audits when consent was never captured', async () => {
    const { gate, record } = build(null);
    await expect(gate.ensureCanStore('org1', 'c1', 'call1', 'u1')).resolves.toBe(false);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'recording.blocked' }));
  });

  it('blocks + audits when there is no matched contact', async () => {
    const { gate, record } = build(null);
    await expect(gate.ensureCanStore('org1', null, 'call1')).resolves.toBe(false);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'recording.blocked', after: { reason: 'no matched contact', contactId: null } }),
    );
  });
});
