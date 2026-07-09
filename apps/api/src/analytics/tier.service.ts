import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { VipTier } from '@crm/types';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

export interface TierThresholds {
  vip: number;
  gold: number;
  silver: number;
}

/**
 * VIP tiering. Assigns CustomerFeatures.vipTier from a configurable input:
 *  - 'clv'   → tiers on clvMinor (falling back to netRevenueMinor when CLV isn't
 *              computed yet), so it upgrades automatically when M5/CLV lands.
 *  - 'spend' → tiers purely on netRevenueMinor (total spend from M3 features).
 * Thresholds are inclusive lower bounds in minor units. Pure `computeTier` is
 * unit-tested; the worker calls `assignAll`.
 */
@Injectable()
export class TierService {
  private readonly logger = new Logger(TierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private thresholds(): TierThresholds {
    return {
      vip: this.config.get('VIP_TIER_VIP_MINOR', { infer: true }),
      gold: this.config.get('VIP_TIER_GOLD_MINOR', { infer: true }),
      silver: this.config.get('VIP_TIER_SILVER_MINOR', { infer: true }),
    };
  }

  /** The value a customer is tiered on, honoring the config switch. */
  tierValue(features: { clvMinor: number | null; netRevenueMinor: number }): number {
    const input = this.config.get('VIP_TIER_INPUT', { infer: true });
    if (input === 'clv') return features.clvMinor ?? features.netRevenueMinor;
    return features.netRevenueMinor;
  }

  /** Assign tiers for every org (called by the nightly analytics refresh). */
  async assignAll(): Promise<number> {
    const orgs = await this.prisma.customerFeatures.findMany({ distinct: ['organizationId'], select: { organizationId: true } });
    let updated = 0;
    for (const { organizationId } of orgs) updated += await this.assignTiersForOrg(organizationId);
    if (updated) this.logger.log(`VIP tiers: updated ${updated} customer(s) across ${orgs.length} org(s)`);
    return updated;
  }

  /** Recompute + persist vipTier for one org; only writes rows whose tier changed. */
  async assignTiersForOrg(organizationId: string): Promise<number> {
    const thresholds = this.thresholds();
    const rows = await this.prisma.customerFeatures.findMany({
      where: { organizationId },
      select: { customerId: true, clvMinor: true, netRevenueMinor: true, vipTier: true },
    });
    let updated = 0;
    for (const r of rows) {
      const tier = computeTier(this.tierValue(r), thresholds);
      if (r.vipTier === tier) continue;
      await this.prisma.customerFeatures.update({
        where: { organizationId_customerId: { organizationId, customerId: r.customerId } },
        data: { vipTier: tier },
      });
      updated += 1;
    }
    return updated;
  }
}

/** Pure tier assignment from a value (minor units) + inclusive lower bounds. */
export function computeTier(valueMinor: number, t: TierThresholds): VipTier {
  if (valueMinor >= t.vip) return 'VIP';
  if (valueMinor >= t.gold) return 'Gold';
  if (valueMinor >= t.silver) return 'Silver';
  return 'Standard';
}
