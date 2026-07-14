import { Body, Controller, Headers, HttpCode, Logger, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { MockTelephonyService } from '../telephony/mock.service';
import { TelephonyStatusService } from '../telephony/telephony-status.service';
import { CallsService } from './calls.service';

/**
 * Public MOCK telephony webhook (POST /webhooks/mock) — lets the default provider
 * be driven end-to-end over HTTP with fixture payloads, exactly like the real
 * routes. HMAC-verified (x-mock-signature over MOCK_WEBHOOK_SECRET) and idempotent
 * on (org, externalCallId). A bad signature is surfaced onto the Integration row.
 */
@Controller('webhooks')
export class MockWebhookController {
  private readonly logger = new Logger(MockWebhookController.name);

  constructor(
    private readonly calls: CallsService,
    private readonly mock: MockTelephonyService,
    private readonly status: TelephonyStatusService,
  ) {}

  @Post('mock')
  @Public()
  @HttpCode(200)
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-mock-signature') signature: string | undefined,
    @Body() body: Record<string, unknown>,
  ): Promise<{ received: boolean; callId: string | null }> {
    const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(body);
    if (!this.mock.verifySignature(raw, signature)) {
      await this.status.recordWebhookSignatureMismatch('mock', (body.companyId as string | undefined) ?? null);
      throw new UnauthorizedException('Invalid webhook signature');
    }
    if (!this.mock.webhookSecretConfigured()) {
      this.logger.warn('MOCK_WEBHOOK_SECRET not set — accepting webhook unverified (dev only)');
    }
    const result = await this.calls.processWebhookEvent(this.mock.parseEvent(body));
    return { received: true, callId: result.callId };
  }
}
