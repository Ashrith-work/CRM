import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Writes MARKETING consent from Shopify `accepts_marketing`. This is what makes
 * the audience-sync ConsentGate meaningful in production — without it no
 * customer would ever be consented and every audience would be empty. Upserts on
 * (org, customerId, MARKETING); source SHOPIFY.
 */
@Injectable()
export class MarketingConsentWriter {
  constructor(private readonly prisma: PrismaService) {}

  async recordFromShopify(organizationId: string, customerId: string, accepts: boolean): Promise<void> {
    const status = accepts ? 'GRANTED' : 'NOT_CAPTURED';
    await this.prisma.consent.upsert({
      where: { organizationId_customerId_purpose: { organizationId, customerId, purpose: 'MARKETING' } },
      update: { status, source: 'SHOPIFY', grantedAt: accepts ? new Date() : null, withdrawnAt: accepts ? null : new Date() },
      create: { organizationId, customerId, purpose: 'MARKETING', status, source: 'SHOPIFY', grantedAt: accepts ? new Date() : null },
    });
  }
}
