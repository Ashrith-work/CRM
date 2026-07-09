import { Injectable } from '@nestjs/common';
import type { SafeCustomer } from '@crm/types';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The PII BOUNDARY. The AI assistant's query tools and any external-API payload
 * builder go through here — and ONLY here — to touch customers. Everything it
 * returns is `SafeCustomer`: customer_id + a pseudonym + non-identifying fields
 * (email DOMAIN, RFM, CLV band, VIP tier, churn band, order count, net revenue).
 *
 * It NEVER decrypts name/email/phone and the return type cannot carry them, so
 * no prompt/payload assembled downstream can read raw PII. Re-identification is
 * exclusively the human, RBAC-gated, audited 360 path — the AI is never in it.
 */
@Injectable()
export class AiSafeCustomerRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Top N customers by a whitelisted metric — pseudonymized. */
  async topCustomers(organizationId: string, by: 'net_revenue' | 'orders' | 'clv', n: number): Promise<SafeCustomer[]> {
    const col = by === 'orders' ? 'orderCount' : by === 'clv' ? 'clvMinor' : 'netRevenueMinor';
    const feats = await this.prisma.customerFeatures.findMany({
      where: { organizationId, [col]: { not: null } },
      orderBy: { [col]: 'desc' },
      take: n,
    });
    return this.toSafe(organizationId, feats);
  }

  async customerSummary(organizationId: string, customerId: string): Promise<SafeCustomer | null> {
    const f = await this.prisma.customerFeatures.findFirst({ where: { organizationId, customerId } });
    if (!f) return null;
    return (await this.toSafe(organizationId, [f]))[0] ?? null;
  }

  async churnWatchlist(organizationId: string, limit: number): Promise<SafeCustomer[]> {
    const feats = await this.prisma.customerFeatures.findMany({
      where: { organizationId, churnBand: { in: ['High', 'Medium'] } },
      orderBy: [{ clvMinor: 'desc' }],
      take: limit,
    });
    return this.toSafe(organizationId, feats);
  }

  async forCustomerIds(organizationId: string, customerIds: string[]): Promise<SafeCustomer[]> {
    if (customerIds.length === 0) return [];
    const feats = await this.prisma.customerFeatures.findMany({ where: { organizationId, customerId: { in: customerIds } } });
    return this.toSafe(organizationId, feats);
  }

  /** Map features → SafeCustomer, joining ONLY the non-PII email domain. */
  private async toSafe(
    organizationId: string,
    feats: Array<{ customerId: string; rSegment: string | null; clvBand: string | null; churnBand: string | null; vipTier: string | null; orderCount: number; netRevenueMinor: number }>,
  ): Promise<SafeCustomer[]> {
    // Only emailDomain is read from Customer — never email/phone/name.
    const customers = await this.prisma.customer.findMany({
      where: { organizationId, id: { in: feats.map((f) => f.customerId) } },
      select: { id: true, emailDomain: true },
    });
    const domainById = new Map(customers.map((c) => [c.id, c.emailDomain]));
    return feats.map((f) => ({
      customerId: f.customerId,
      pseudonym: `Customer #${f.customerId.slice(-6)}`,
      emailDomain: domainById.get(f.customerId) ?? null,
      rfmSegment: f.rSegment,
      clvBand: f.clvBand,
      churnBand: f.churnBand,
      vipTier: f.vipTier,
      orderCount: f.orderCount,
      netRevenueMinor: f.netRevenueMinor,
    }));
  }
}
