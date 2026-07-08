import { Injectable, NotFoundException } from '@nestjs/common';
import type { Campaign, CampaignSend, Enrollment, RecoveryStats } from '@crm/types';
import { PrismaService } from '../prisma/prisma.service';
import { maskEmail } from '../common/pii.util';

/** Read side of recovery: campaign summaries, enrollment lists, and the
 * recovery-rate tile — all computed from real CampaignSend + Order data. */
@Injectable()
export class CampaignService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string): Promise<Campaign[]> {
    const campaigns = await this.prisma.campaign.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { steps: { orderBy: { stepOrder: 'asc' }, include: { template: true } } },
    });
    return Promise.all(campaigns.map((c) => this.serialize(c)));
  }

  private async serialize(c: NonNullable<Awaited<ReturnType<CampaignService['loadOne']>>>): Promise<Campaign> {
    const [enrollmentCount, activeCount, recoveredCount, sentCount] = await Promise.all([
      this.prisma.campaignEnrollment.count({ where: { campaignId: c.id } }),
      this.prisma.campaignEnrollment.count({ where: { campaignId: c.id, status: 'ACTIVE' } }),
      this.prisma.campaignEnrollment.count({ where: { campaignId: c.id, status: 'CONVERTED' } }),
      this.prisma.campaignSend.count({ where: { enrollment: { campaignId: c.id }, status: { in: ['SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'BOUNCED'] } } }),
    ]);
    return {
      id: c.id,
      name: c.name,
      type: 'ABANDONED_CART',
      status: c.status,
      channel: c.channel,
      attributionWindowMinutes: c.attributionWindowMinutes,
      steps: c.steps.map((s) => ({ id: s.id, stepOrder: s.stepOrder, delayMinutes: s.delayMinutes, templateId: s.templateId, templateKey: s.template.key, templateVersion: s.template.version, subject: s.template.subject })),
      enrollmentCount,
      activeCount,
      sentCount,
      recoveredCount,
      createdAt: c.createdAt.toISOString(),
    };
  }

  private loadOne(organizationId: string, id: string) {
    return this.prisma.campaign.findFirst({ where: { id, organizationId, deletedAt: null }, include: { steps: { orderBy: { stepOrder: 'asc' }, include: { template: true } } } });
  }

  async enrollments(organizationId: string, campaignId: string, cursor: string | undefined, limit: number, unmasked: boolean): Promise<{ data: Enrollment[]; nextCursor: string | null }> {
    const rows = await this.prisma.campaignEnrollment.findMany({
      where: { organizationId, campaignId },
      orderBy: { enrolledAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { sends: { orderBy: { campaignStepId: 'asc' }, include: { step: true } } },
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const data: Enrollment[] = page.map((e) => ({
      id: e.id,
      email: unmasked ? e.email : maskEmail(e.email),
      status: e.status,
      checkoutStartedAt: e.checkoutStartedAt.toISOString(),
      enrolledAt: e.enrolledAt.toISOString(),
      convertedAt: e.convertedAt ? e.convertedAt.toISOString() : null,
      haltReason: e.haltReason,
      sends: e.sends.map(serializeSend),
    }));
    const last = page[page.length - 1];
    return { data, nextCursor: hasMore && last ? last.id : null };
  }

  async recoveryStats(organizationId: string, now = new Date()): Promise<RecoveryStats> {
    const [abandonedCarts, converted, sendCounts, sampleCurrency] = await Promise.all([
      this.prisma.campaignEnrollment.count({ where: { organizationId } }),
      this.prisma.campaignEnrollment.findMany({ where: { organizationId, status: 'CONVERTED', convertedOrderId: { not: null } }, include: { campaign: { select: { attributionWindowMinutes: true } } } }),
      this.prisma.campaignSend.groupBy({ by: ['status'], where: { organizationId }, _count: { _all: true } }),
      this.prisma.order.findFirst({ where: { organizationId }, select: { currency: true } }),
    ]);

    // Recovered = converted within the attribution window of enrollment.
    const recovered = converted.filter((e) => e.convertedAt && e.convertedAt.getTime() - e.enrolledAt.getTime() <= e.campaign.attributionWindowMinutes * 60_000);
    const orderIds = recovered.map((e) => e.convertedOrderId!).filter(Boolean);
    const orders = orderIds.length ? await this.prisma.order.findMany({ where: { organizationId, id: { in: orderIds } }, select: { totalMinor: true, refundedMinor: true } }) : [];
    const recoveredRevenueMinor = orders.reduce((sum, o) => sum + (o.totalMinor - o.refundedMinor), 0);

    const count = (statuses: string[]) => sendCounts.filter((s) => statuses.includes(s.status)).reduce((n, s) => n + s._count._all, 0);
    return {
      abandonedCarts,
      recoveredCarts: recovered.length,
      recoveryRate: abandonedCarts ? recovered.length / abandonedCarts : 0,
      recoveredRevenueMinor,
      currency: sampleCurrency?.currency ?? null,
      sends: {
        total: sendCounts.reduce((n, s) => n + s._count._all, 0),
        sent: count(['SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'BOUNCED']),
        blocked: count(['BLOCKED']),
        bounced: count(['BOUNCED']),
        opened: count(['OPENED', 'CLICKED']),
        clicked: count(['CLICKED']),
        delayed: count(['DELAYED']),
      },
      lastRefreshedAt: now.toISOString(),
    };
  }

  async requireCampaign(organizationId: string, id: string): Promise<{ id: string }> {
    const c = await this.prisma.campaign.findFirst({ where: { id, organizationId, deletedAt: null }, select: { id: true } });
    if (!c) throw new NotFoundException('Campaign not found');
    return c;
  }
}

function serializeSend(s: { id: string; channel: 'EMAIL'; templateVersion: number; status: CampaignSend['status']; blockedReason: string | null; sentAt: Date | null; outcomeAt: Date | null; step: { stepOrder: number } }): CampaignSend {
  return {
    id: s.id,
    stepOrder: s.step.stepOrder,
    channel: s.channel,
    templateVersion: s.templateVersion,
    status: s.status,
    blockedReason: s.blockedReason,
    sentAt: s.sentAt ? s.sentAt.toISOString() : null,
    outcomeAt: s.outcomeAt ? s.outcomeAt.toISOString() : null,
  };
}
