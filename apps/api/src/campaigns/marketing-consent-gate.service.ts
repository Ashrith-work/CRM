import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface GateResult {
  allowed: boolean;
  reason?: string;
}

/**
 * The marketing ConsentGate — MANDATORY before any marketing send. A send is
 * allowed ONLY if the customer has GRANTED marketing consent AND the email is
 * NOT suppressed. A blocked send is LOGGED (audit + return reason), never
 * silently skipped. (Call-recording consent has its own gate in M5.)
 */
@Injectable()
export class MarketingConsentGate {
  private readonly logger = new Logger(MarketingConsentGate.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** True only when marketing consent is granted and the email is not suppressed. */
  async canSend(
    organizationId: string,
    customerId: string,
    email: string,
    ctx?: { enrollmentId?: string },
  ): Promise<GateResult> {
    const reason = await this.blockReason(organizationId, customerId, email);
    if (!reason) return { allowed: true };

    this.logger.warn(`Marketing send blocked for ${email}: ${reason}`);
    await this.audit.record({
      organizationId,
      actorUserId: null,
      action: 'marketing.blocked',
      entity: 'CampaignEnrollment',
      entityId: ctx?.enrollmentId ?? null,
      after: { reason, customerId, email },
    });
    return { allowed: false, reason };
  }

  /** Cheap filter used at enrollment time (no audit — nothing was sent yet). */
  async isEligible(organizationId: string, customerId: string, email: string): Promise<boolean> {
    return (await this.blockReason(organizationId, customerId, email)) === null;
  }

  private async blockReason(organizationId: string, customerId: string, email: string): Promise<string | null> {
    const consent = await this.prisma.consent.findFirst({
      where: { organizationId, customerId, purpose: 'MARKETING', deletedAt: null },
      select: { status: true },
    });
    if (!consent) return 'consent not captured';
    if (consent.status !== 'GRANTED') return `consent ${consent.status.toLowerCase()}`;

    const suppressed = await this.prisma.suppression.findUnique({
      where: { organizationId_email: { organizationId, email } },
      select: { reason: true },
    });
    if (suppressed) return `suppressed:${suppressed.reason.toLowerCase()}`;
    return null;
  }
}
