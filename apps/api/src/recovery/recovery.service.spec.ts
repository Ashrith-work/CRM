import { RecoveryService } from './recovery.service';
import { makePii } from '../common/crypto.testkit';
import { maskEmail } from '../common/pii.util';
import type { PrismaService } from '../prisma/prisma.service';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import type { AuditService } from '../audit/audit.service';

/**
 * Recovery-lead segments + assignment + conversion. Prisma is mocked; the PII
 * service is REAL (crypto.testkit) so masking is exercised for real.
 */
const { pii } = makePii();
const DAY = 86_400_000;
const config = { get: () => 60 } as unknown as ConfigService<Env, true>; // ABANDONED_CART_THRESHOLD_MINUTES

function cust(id: string, over: Record<string, unknown> = {}) {
  const p = pii.protect({ email: 'jane@nerige.co', phone: '+919876543210', firstName: 'Jane', lastName: 'Doe' });
  return {
    id, organizationId: 'org1', externalId: '5551234', email: p.email, phone: p.phone, firstName: p.firstName,
    lastName: p.lastName, emailHash: p.emailHash, phoneHash: p.phoneHash, emailDomain: p.emailDomain,
    mergedIntoId: null, ownerUserId: null, recoveryStatus: null, recoveryConvertedAt: null, deletedAt: null,
    createdAt: new Date(Date.now() - 5 * DAY), updatedAt: new Date(), ...over,
  };
}

function svc(prisma: Record<string, unknown>, audit = { record: jest.fn() }) {
  return {
    service: new RecoveryService(prisma as unknown as PrismaService, pii, audit as unknown as AuditService, config),
    audit,
  };
}

describe('RecoveryService', () => {
  describe('cart-abandoner segment', () => {
    const cart = { customerId: 'c1', checkoutStartedAt: new Date(Date.now() - 2 * 3600_000), items: [{ title: 'Shoes', quantity: 2, priceMinor: 5000 }] };

    it('lists an abandoner with cart summary + value, masks PII for non-admin', async () => {
      const { service } = svc({
        cart: { findMany: jest.fn().mockResolvedValue([cart]), count: jest.fn().mockResolvedValue(3) },
        order: { findMany: jest.fn().mockResolvedValue([]) }, // no buyers
        customer: { findMany: jest.fn().mockResolvedValue([cust('c1')]) },
        commerceEvent: { count: jest.fn() },
      });
      const res = await service.listProspects('org1', 'cart_abandoner', false);
      expect(res.data).toHaveLength(1);
      expect(res.data[0].cartSummary).toBe('Shoes ×2');
      expect(res.data[0].valueAtRiskMinor).toBe(10000);
      expect(res.data[0].email).toBe(maskEmail('jane@nerige.co'));
      expect(res.data[0].masked).toBe(true);
      expect(res.data[0].displayName).toBe('Jane Doe');
      expect(res.anonymousCount).toBe(3); // anonymous carts counted, not listed
    });

    it('unmasks PII for admin (pii:read)', async () => {
      const { service } = svc({
        cart: { findMany: jest.fn().mockResolvedValue([cart]), count: jest.fn().mockResolvedValue(0) },
        order: { findMany: jest.fn().mockResolvedValue([]) },
        customer: { findMany: jest.fn().mockResolvedValue([cust('c1')]) },
        commerceEvent: { count: jest.fn() },
      });
      const res = await service.listProspects('org1', 'cart_abandoner', true);
      expect(res.data[0].email).toBe('jane@nerige.co');
      expect(res.data[0].masked).toBe(false);
    });

    it('excludes a customer who later BOUGHT (no longer a prospect)', async () => {
      const { service } = svc({
        cart: { findMany: jest.fn().mockResolvedValue([cart]), count: jest.fn().mockResolvedValue(0) },
        order: { findMany: jest.fn().mockResolvedValue([{ customerId: 'c1' }]) }, // c1 has a paid order
        customer: { findMany: jest.fn().mockResolvedValue([cust('c1')]) },
        commerceEvent: { count: jest.fn() },
      });
      const res = await service.listProspects('org1', 'cart_abandoner', true);
      expect(res.data).toHaveLength(0);
    });
  });

  describe('non-buyer segment', () => {
    it('lists identified non-buyers, excludes buyers, counts anonymous sessions', async () => {
      const { service } = svc({
        customer: { findMany: jest.fn().mockResolvedValue([cust('c1'), cust('c2', { externalId: '999' })]) },
        order: { findMany: jest.fn().mockResolvedValue([{ customerId: 'c2' }]) }, // c2 bought
        commerceEvent: { count: jest.fn().mockResolvedValue(7) },
      });
      const res = await service.listProspects('org1', 'non_buyer', false);
      expect(res.data.map((d) => d.customerId)).toEqual(['c1']); // c2 excluded (buyer)
      expect(res.anonymousCount).toBe(7);
    });
  });

  describe('assignment', () => {
    it('assigns only prospects (never a buyer) + writes history + audit', async () => {
      const historyCreate = jest.fn().mockResolvedValue({});
      const { service, audit } = svc({
        order: { findMany: jest.fn().mockResolvedValue([{ customerId: 'c2' }]) }, // c2 is a buyer
        customer: {
          findFirst: jest.fn().mockResolvedValue({ ownerUserId: null, recoveryStatus: null }),
          update: jest.fn().mockResolvedValue({}),
        },
        customerAssignmentHistory: { create: historyCreate },
      });
      const res = await service.assign('org1', 'actor1', { customerIds: ['c1', 'c2'], toUserId: 'rep1' });
      expect(res.updated).toBe(1); // only c1 (c2 is a buyer, skipped)
      expect(historyCreate).toHaveBeenCalledTimes(1);
      expect(historyCreate.mock.calls[0][0].data).toMatchObject({ customerId: 'c1', toUserId: 'rep1', actorUserId: 'actor1' });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'recovery.assign' }));
    });
  });

  describe('conversion attribution', () => {
    it('auto-converts an owned prospect who now has a qualifying order + credits the owner', async () => {
      const update = jest.fn().mockResolvedValue({});
      const progressCreate = jest.fn().mockResolvedValue({});
      const { service } = svc({
        customer: { findMany: jest.fn().mockResolvedValue([{ id: 'c1', ownerUserId: 'rep1' }]), update },
        order: { findMany: jest.fn().mockResolvedValue([{ customerId: 'c1' }]) }, // c1 now bought
        progressUpdate: { create: progressCreate },
      });
      const n = await service.reconcileConversions('org1');
      expect(n).toBe(1);
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c1' }, data: expect.objectContaining({ recoveryStatus: 'converted' }) }));
      expect(progressCreate.mock.calls[0][0].data).toMatchObject({ customerId: 'c1', authorUserId: 'rep1', status: 'converted' });
    });

    it('does nothing for owned prospects who have NOT bought', async () => {
      const update = jest.fn();
      const { service } = svc({
        customer: { findMany: jest.fn().mockResolvedValue([{ id: 'c1', ownerUserId: 'rep1' }]), update },
        order: { findMany: jest.fn().mockResolvedValue([]) }, // no buyers
        progressUpdate: { create: jest.fn() },
      });
      expect(await service.reconcileConversions('org1')).toBe(0);
      expect(update).not.toHaveBeenCalled();
    });
  });
});
