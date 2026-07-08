import { Body, Controller, Headers, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { ResendWebhookService } from './resend-webhook.service';

/**
 * Public Resend delivery webhook. When RESEND_WEBHOOK_SECRET is set the HMAC is
 * verified over the raw body first (401 on mismatch); events map to CampaignSend
 * status + Suppression. Acks 200.
 */
@Controller('webhooks')
export class ResendWebhookController {
  constructor(private readonly webhooks: ResendWebhookService) {}

  @Post('resend')
  @Public()
  @HttpCode(200)
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('resend-signature') signature: string | undefined,
    @Body() body: unknown,
  ): Promise<{ received: boolean }> {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(body ?? {}));
    if (!this.webhooks.verify(raw, signature)) throw new UnauthorizedException('Invalid webhook signature');
    await this.webhooks.handle((body ?? {}) as { type?: string; data?: { email_id?: string; to?: string | string[] } });
    return { received: true };
  }
}
