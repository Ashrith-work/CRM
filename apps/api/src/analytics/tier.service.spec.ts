import { TierService, computeTier, type TierThresholds } from './tier.service';

const T: TierThresholds = { vip: 5_000_000, gold: 2_000_000, silver: 500_000 };

describe('computeTier (pure)', () => {
  it('bands by inclusive lower bounds', () => {
    expect(computeTier(6_000_000, T)).toBe('VIP');
    expect(computeTier(5_000_000, T)).toBe('VIP'); // inclusive
    expect(computeTier(2_500_000, T)).toBe('Gold');
    expect(computeTier(600_000, T)).toBe('Silver');
    expect(computeTier(100_000, T)).toBe('Standard');
    expect(computeTier(0, T)).toBe('Standard');
  });
});

function svcWith(config: Record<string, unknown>, prisma: unknown = {}) {
  const configService = { get: (k: string) => config[k] };
  return new TierService(prisma as never, configService as never);
}

describe('TierService.tierValue (config switch)', () => {
  const base = { VIP_TIER_VIP_MINOR: 5_000_000, VIP_TIER_GOLD_MINOR: 2_000_000, VIP_TIER_SILVER_MINOR: 500_000 };

  it('input "clv" tiers on clvMinor, falling back to netRevenueMinor when CLV is unset', () => {
    const svc = svcWith({ ...base, VIP_TIER_INPUT: 'clv' });
    expect(svc.tierValue({ clvMinor: 3_000_000, netRevenueMinor: 1_000_000 })).toBe(3_000_000);
    expect(svc.tierValue({ clvMinor: null, netRevenueMinor: 1_000_000 })).toBe(1_000_000); // fallback
  });

  it('input "spend" always tiers on netRevenueMinor (ignores CLV)', () => {
    const svc = svcWith({ ...base, VIP_TIER_INPUT: 'spend' });
    expect(svc.tierValue({ clvMinor: 9_000_000, netRevenueMinor: 1_000_000 })).toBe(1_000_000);
  });
});

describe('TierService.assignTiersForOrg', () => {
  it('only writes customers whose tier changed', async () => {
    const update = jest.fn().mockResolvedValue({});
    const prisma = {
      customerFeatures: {
        findMany: jest.fn().mockResolvedValue([
          { customerId: 'a', clvMinor: 6_000_000, netRevenueMinor: 0, vipTier: null },      // → VIP (changed)
          { customerId: 'b', clvMinor: 100_000, netRevenueMinor: 0, vipTier: 'Standard' },   // → Standard (unchanged)
          { customerId: 'c', clvMinor: 600_000, netRevenueMinor: 0, vipTier: 'Gold' },       // → Silver (changed)
        ]),
        update,
      },
    };
    const svc = svcWith({ VIP_TIER_INPUT: 'clv', VIP_TIER_VIP_MINOR: 5_000_000, VIP_TIER_GOLD_MINOR: 2_000_000, VIP_TIER_SILVER_MINOR: 500_000 }, prisma);

    const updated = await svc.assignTiersForOrg('org1');

    expect(updated).toBe(2); // a and c only
    expect(update).toHaveBeenCalledWith({ where: { organizationId_customerId: { organizationId: 'org1', customerId: 'a' } }, data: { vipTier: 'VIP' } });
    expect(update).toHaveBeenCalledWith({ where: { organizationId_customerId: { organizationId: 'org1', customerId: 'c' } }, data: { vipTier: 'Silver' } });
  });
});
