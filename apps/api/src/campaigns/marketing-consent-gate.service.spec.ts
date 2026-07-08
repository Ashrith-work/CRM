import { MarketingConsentGate } from './marketing-consent-gate.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';

function gate(consent: { status: string } | null, suppression: { reason: string } | null) {
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const prisma = {
    consent: { findFirst: jest.fn().mockResolvedValue(consent) },
    suppression: { findUnique: jest.fn().mockResolvedValue(suppression) },
  } as unknown as PrismaService;
  return { gate: new MarketingConsentGate(prisma, audit as unknown as AuditService), audit };
}

describe('MarketingConsentGate — the mandatory send gate', () => {
  it('allows only granted marketing consent AND not suppressed', async () => {
    const { gate: g, audit } = gate({ status: 'GRANTED' }, null);
    expect(await g.canSend('org1', 'c1', 'a@x.co')).toEqual({ allowed: true });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('blocks + AUDITS when consent not captured', async () => {
    const { gate: g, audit } = gate(null, null);
    const res = await g.canSend('org1', 'c1', 'a@x.co', { enrollmentId: 'e1' });
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/not captured/);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'marketing.blocked', entityId: 'e1' }));
  });

  it('blocks + audits when consent withdrawn', async () => {
    const { gate: g, audit } = gate({ status: 'WITHDRAWN' }, null);
    const res = await g.canSend('org1', 'c1', 'a@x.co');
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('withdrawn');
    expect(audit.record).toHaveBeenCalled();
  });

  it('blocks + audits when the email is suppressed (even with consent)', async () => {
    const { gate: g, audit } = gate({ status: 'GRANTED' }, { reason: 'UNSUBSCRIBE' });
    const res = await g.canSend('org1', 'c1', 'a@x.co');
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('suppressed');
    expect(audit.record).toHaveBeenCalled();
  });

  it('isEligible is a silent filter (no audit)', async () => {
    const { gate: g, audit } = gate({ status: 'GRANTED' }, null);
    expect(await g.isEligible('org1', 'c1', 'a@x.co')).toBe(true);
    const { gate: g2, audit: a2 } = gate(null, null);
    expect(await g2.isEligible('org1', 'c1', 'a@x.co')).toBe(false);
    expect(audit.record).not.toHaveBeenCalled();
    expect(a2.record).not.toHaveBeenCalled();
  });
});
