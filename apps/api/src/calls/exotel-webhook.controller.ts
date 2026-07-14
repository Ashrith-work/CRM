import { Body, Controller, Headers, HttpCode, Logger, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { ExotelService } from '../telephony/exotel.service';
import { TelephonyStatusService } from '../telephony/telephony-status.service';
import { CallsService } from './calls.service';

/**
 * Public Exotel status-callback webhook. Verified (HMAC when EXOTEL_WEBHOOK_SECRET
 * is set) + idempotent on the (org, externalCallId) unique key — a retried event
 * yields exactly one Call. Parses with the Exotel adapter; processing is shared.
 */
@Controller('webhooks')
export class ExotelWebhookController {
  private readonly logger = new Logger(ExotelWebhookController.name);

  constructor(
    private readonly calls: CallsService,
    private readonly exotel: ExotelService,
    private readonly status: TelephonyStatusService,
  ) {}

  @Post('exotel')
  @Public()
  @HttpCode(200)
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-exotel-signature') signature: string | undefined,
    @Body() body: Record<string, unknown>,
  ): Promise<{ received: boolean; callId: string | null }> {
    const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(body);
    if (!this.exotel.verifySignature(raw, signature)) {
      // Exotel callbacks don't echo the account SID; use the configured one so the
      // org can still be resolved for surfacing.
      await this.status.recordWebhookSignatureMismatch('exotel', this.exotel.parseEvent(body).companyId);
      throw new UnauthorizedException('Invalid webhook signature');
    }
    if (!this.exotel.webhookSecretConfigured()) {
      this.logger.warn('EXOTEL_WEBHOOK_SECRET not set — accepting webhook unverified (dev only)');
    }
    const result = await this.calls.processWebhookEvent(this.exotel.parseEvent(body));
    return { received: true, callId: result.callId };
  }
}
