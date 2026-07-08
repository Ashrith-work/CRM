import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Prisma, Campaign, CampaignEnrollment, MessageTemplate } from '@prisma/client';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { MarketingConsentGate } from './marketing-consent-gate.service';
import { ResendAdapter } from '../messaging/resend.adapter';

type StepWithTemplate = Prisma.CampaignStepGetPayload<{ include: { template: true } }>;

/**
 * The recovery engine — two restart-safe SWEEPS (not one delayed job per step):
 *  • enrollment sweep: find abandoned carts (older than the threshold, unconverted,
 *    consented + not suppressed) and enroll them idempotently.
 *  • send sweep: for each active enrollment, fire the earliest DUE step — but first
 *    HALT ON PURCHASE (re-check the cart's convertedOrderId) and re-check consent.
 * Every send writes a CampaignSend; a provider outage marks the send DELAYED (not
 * failed) and is retried on the next tick.
 */
@Injectable()
export class CampaignEngine {
  private readonly logger = new Logger(CampaignEngine.name);
  private readonly thresholdMinutes: number;
  private readonly baseUrl: string;
  private readonly unsubscribeSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gate: MarketingConsentGate,
    private readonly email: ResendAdapter,
    config: ConfigService<Env, true>,
  ) {
    this.thresholdMinutes = config.get('ABANDONED_CART_THRESHOLD_MINUTES', { infer: true });
    this.baseUrl = config.get('APP_BASE_URL', { infer: true });
    this.unsubscribeSecret = config.get('UNSUBSCRIBE_SECRET', { infer: true });
  }

  // ===== Enrollment sweep =================================================
  async runEnrollmentSweep(now = new Date()): Promise<number> {
    const campaigns = await this.prisma.campaign.findMany({ where: { type: 'ABANDONED_CART', status: 'ACTIVE', deletedAt: null } });
    let enrolled = 0;
    for (const campaign of campaigns) enrolled += await this.enrollAbandonedCarts(campaign, now);
    if (enrolled) this.logger.log(`Enrollment sweep: enrolled ${enrolled} cart(s)`);
    return enrolled;
  }

  private async enrollAbandonedCarts(campaign: Campaign, now: Date): Promise<number> {
    const threshold = new Date(now.getTime() - this.thresholdMinutes * 60_000);
    const carts = await this.prisma.cart.findMany({
      where: { organizationId: campaign.organizationId, deletedAt: null, convertedOrderId: null, customerId: { not: null }, checkoutStartedAt: { lte: threshold } },
      take: 500,
    });
    if (!carts.length) return 0;

    // Drop carts already enrolled in this campaign (idempotency, pre-filter).
    const existing = await this.prisma.campaignEnrollment.findMany({ where: { campaignId: campaign.id, cartId: { in: carts.map((c) => c.id) } }, select: { cartId: true } });
    const already = new Set(existing.map((e) => e.cartId));
    const fresh = carts.filter((c) => !already.has(c.id));
    if (!fresh.length) return 0;

    const customers = await this.prisma.customer.findMany({ where: { organizationId: campaign.organizationId, id: { in: [...new Set(fresh.map((c) => c.customerId!))] }, deletedAt: null }, select: { id: true, email: true } });
    const emailById = new Map(customers.map((c) => [c.id, c.email]));

    const rows: Prisma.CampaignEnrollmentCreateManyInput[] = [];
    for (const cart of fresh) {
      const email = emailById.get(cart.customerId!);
      if (!email) continue;
      // Enroll only consented + non-suppressed customers (a filter, not a blocked send).
      if (!(await this.gate.isEligible(campaign.organizationId, cart.customerId!, email))) continue;
      rows.push({ organizationId: campaign.organizationId, campaignId: campaign.id, cartId: cart.id, customerId: cart.customerId!, email, checkoutStartedAt: cart.checkoutStartedAt, status: 'ACTIVE' });
    }
    if (!rows.length) return 0;
    const res = await this.prisma.campaignEnrollment.createMany({ data: rows, skipDuplicates: true });
    return res.count;
  }

  // ===== Send sweep =======================================================
  async runSendSweep(now = new Date()): Promise<number> {
    const enrollments = await this.prisma.campaignEnrollment.findMany({ where: { status: 'ACTIVE' }, take: 1000 });
    let sent = 0;
    for (const e of enrollments) if (await this.processEnrollment(e, now)) sent += 1;
    if (sent) this.logger.log(`Send sweep: fired ${sent} step(s)`);
    return sent;
  }

  async processEnrollment(enrollment: CampaignEnrollment, now = new Date()): Promise<boolean> {
    // 1) HALT ON PURCHASE — the cart's convertedOrderId is set by M1 ingestion.
    const cart = await this.prisma.cart.findUnique({ where: { id: enrollment.cartId }, select: { convertedOrderId: true } });
    if (cart?.convertedOrderId) {
      await this.halt(enrollment.id, 'CONVERTED', 'purchased', { convertedOrderId: cart.convertedOrderId, convertedAt: now });
      return false;
    }

    // 2) Re-check consent/suppression (withdrawal mid-sequence halts on this tick).
    const decision = await this.gate.canSend(enrollment.organizationId, enrollment.customerId, enrollment.email, { enrollmentId: enrollment.id });
    if (!decision.allowed) {
      await this.recordBlocked(enrollment, decision.reason ?? 'blocked', now);
      await this.halt(enrollment.id, 'HALTED', decision.reason ?? 'blocked');
      return false;
    }

    // 3) Fire the earliest DUE step that isn't already terminally sent.
    const steps = await this.prisma.campaignStep.findMany({ where: { campaignId: enrollment.campaignId }, orderBy: { stepOrder: 'asc' }, include: { template: true } });
    const sends = await this.prisma.campaignSend.findMany({ where: { enrollmentId: enrollment.id } });
    const sendByStep = new Map(sends.map((s) => [s.campaignStepId, s]));

    let didSend = false;
    for (const step of steps) {
      const dueAt = new Date(enrollment.checkoutStartedAt.getTime() + step.delayMinutes * 60_000);
      if (dueAt > now) break; // steps are ordered; nothing further is due
      const existing = sendByStep.get(step.id);
      if (existing && existing.status !== 'DELAYED' && existing.status !== 'QUEUED') continue; // already handled
      didSend = await this.sendStep(enrollment, step, existing?.id);
      break; // one send per enrollment per tick
    }

    // Complete once every step has a terminal (non-retryable) send.
    if (!didSend) {
      const terminal = steps.filter((s) => {
        const x = sendByStep.get(s.id);
        return x && x.status !== 'DELAYED' && x.status !== 'QUEUED';
      }).length;
      if (steps.length > 0 && terminal === steps.length) {
        await this.prisma.campaignEnrollment.update({ where: { id: enrollment.id }, data: { status: 'COMPLETED' } });
      }
    }
    return didSend;
  }

  private async sendStep(enrollment: CampaignEnrollment, step: StepWithTemplate, existingSendId?: string): Promise<boolean> {
    const rendered = this.render(step.template, { email: enrollment.email, unsubscribeUrl: this.unsubscribeUrl(enrollment.organizationId, enrollment.email) });
    const base: Prisma.CampaignSendUncheckedCreateInput = {
      organizationId: enrollment.organizationId,
      enrollmentId: enrollment.id,
      campaignStepId: step.id,
      channel: 'EMAIL',
      templateVersion: step.template.version,
      status: 'QUEUED',
    };
    try {
      const result = await this.email.send({ to: enrollment.email, subject: rendered.subject, html: rendered.html, text: rendered.text });
      await this.writeSend(existingSendId, base, { status: 'SENT', providerMessageId: result.providerMessageId, sentAt: new Date() });
      return true;
    } catch (err) {
      // Provider outage → DELAYED (not failed); retried next tick.
      this.logger.warn(`Send delayed for ${enrollment.email}: ${(err as Error).message}`);
      await this.writeSend(existingSendId, base, { status: 'DELAYED' });
      return false;
    }
  }

  /** Record a BLOCKED send for the next due step (blocked + logged, never silent). */
  private async recordBlocked(enrollment: CampaignEnrollment, reason: string, now: Date): Promise<void> {
    const steps = await this.prisma.campaignStep.findMany({ where: { campaignId: enrollment.campaignId }, orderBy: { stepOrder: 'asc' }, include: { template: true } });
    const sends = await this.prisma.campaignSend.findMany({ where: { enrollmentId: enrollment.id }, select: { campaignStepId: true } });
    const done = new Set(sends.map((s) => s.campaignStepId));
    const step = steps.find((s) => new Date(enrollment.checkoutStartedAt.getTime() + s.delayMinutes * 60_000) <= now && !done.has(s.id)) ?? steps[0];
    if (!step) return;
    await this.writeSend(undefined, {
      organizationId: enrollment.organizationId,
      enrollmentId: enrollment.id,
      campaignStepId: step.id,
      channel: 'EMAIL',
      templateVersion: step.template.version,
      status: 'QUEUED',
    }, { status: 'BLOCKED', blockedReason: reason, outcomeAt: now });
  }

  private async writeSend(id: string | undefined, base: Prisma.CampaignSendUncheckedCreateInput, extra: Prisma.CampaignSendUncheckedUpdateInput): Promise<void> {
    if (id) {
      await this.prisma.campaignSend.update({ where: { id }, data: extra });
    } else {
      await this.prisma.campaignSend.create({ data: { ...base, ...(extra as Prisma.CampaignSendUncheckedCreateInput) } });
    }
  }

  private async halt(enrollmentId: string, status: 'CONVERTED' | 'HALTED', reason: string, extra?: { convertedOrderId?: string; convertedAt?: Date }): Promise<void> {
    await this.prisma.campaignEnrollment.update({
      where: { id: enrollmentId },
      data: { status, haltReason: reason, haltedAt: status === 'HALTED' ? new Date() : null, ...(extra ?? {}) },
    });
  }

  // ===== templates + unsubscribe =========================================
  private render(template: MessageTemplate, vars: { email: string; unsubscribeUrl: string }): { subject: string; html: string; text: string } {
    const fill = (s: string) => s.replaceAll('{{email}}', vars.email).replaceAll('{{unsubscribe_url}}', vars.unsubscribeUrl);
    return { subject: fill(template.subject), html: fill(template.bodyHtml), text: fill(template.bodyText) };
  }

  unsubscribeUrl(organizationId: string, email: string): string {
    const sig = this.signUnsubscribe(organizationId, email);
    return `${this.baseUrl}/api/v1/campaigns/unsubscribe?e=${encodeURIComponent(email)}&o=${organizationId}&sig=${sig}`;
  }

  signUnsubscribe(organizationId: string, email: string): string {
    return createHmac('sha256', this.unsubscribeSecret).update(`${organizationId}:${email.toLowerCase()}`).digest('hex');
  }

  verifyUnsubscribe(organizationId: string, email: string, sig: string): boolean {
    const expected = this.signUnsubscribe(organizationId, email);
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
