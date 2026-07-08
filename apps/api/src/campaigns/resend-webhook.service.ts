import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CampaignSendStatus, SuppressionReason } from '@prisma/client';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

interface ResendEvent {
  type?: string;
  data?: { email_id?: string; to?: string | string[] };
}

/**
 * Resend delivery webhooks → CampaignSend status + Suppression. bounce/complaint
 * add the address to Suppression so future marketing sends are gated out.
 */
@Injectable()
export class ResendWebhookService {
  private readonly logger = new Logger(ResendWebhookService.name);
  private readonly secret?: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.secret = config.get('RESEND_WEBHOOK_SECRET', { infer: true });
  }

  /** When a secret is set, require a valid HMAC; in dev (unset) accept with a warn. */
  verify(rawBody: Buffer, signature: string | undefined): boolean {
    if (!this.secret) {
      this.logger.warn('RESEND_WEBHOOK_SECRET unset — accepting webhook without verification (dev)');
      return true;
    }
    if (!signature) return false;
    const digest = createHmac('sha256', this.secret).update(rawBody).digest('hex');
    const a = Buffer.from(digest);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async handle(event: ResendEvent): Promise<void> {
    const emailId = event.data?.email_id;
    const to = Array.isArray(event.data?.to) ? event.data?.to[0] : event.data?.to;
    const now = new Date();
    const send = emailId ? await this.prisma.campaignSend.findFirst({ where: { providerMessageId: emailId } }) : null;

    switch (event.type) {
      case 'email.delivered':
        await this.advance(send?.id, 'DELIVERED', now);
        break;
      case 'email.opened':
        await this.advance(send?.id, 'OPENED', now);
        break;
      case 'email.clicked':
        await this.advance(send?.id, 'CLICKED', now);
        break;
      case 'email.bounced':
        await this.advance(send?.id, 'BOUNCED', now);
        if (send && to) await this.suppress(send.organizationId, to, 'BOUNCE');
        break;
      case 'email.complained':
        if (send && to) await this.suppress(send.organizationId, to, 'COMPLAINT');
        break;
      default:
        this.logger.debug(`Ignoring Resend event ${event.type ?? 'unknown'}`);
    }
  }

  private async advance(sendId: string | undefined, status: CampaignSendStatus, at: Date): Promise<void> {
    if (!sendId) return;
    await this.prisma.campaignSend.update({ where: { id: sendId }, data: { status, outcomeAt: at } });
  }

  async suppress(organizationId: string, email: string, reason: SuppressionReason): Promise<void> {
    await this.prisma.suppression.upsert({
      where: { organizationId_email: { organizationId, email: email.toLowerCase() } },
      update: { reason },
      create: { organizationId, email: email.toLowerCase(), reason },
    });
  }
}
