import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { MyOperatorWebhookSchema, type MyOperatorWebhook } from '@crm/types';
import { Public } from '../auth/public.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { MyOperatorService } from '../telephony/myoperator.service';
import { CallsService } from './calls.service';

/**
 * Public MyOperator webhook. Authenticity is verified by HMAC signature over the
 * raw body (rejecting spoofed events); processing is idempotent on the
 * (org, externalCallId) unique key, so a retried event yields exactly one Call.
 */
@Controller('webhooks')
export class MyOperatorWebhookController {
  private readonly logger = new Logger(MyOperatorWebhookController.name);

  constructor(
    private readonly calls: CallsService,
    private readonly myoperator: MyOperatorService,
  ) {}

  @Post('myoperator')
  @Public()
  @HttpCode(200)
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-myoperator-signature') signature: string | undefined,
    @Body(new ZodValidationPipe(MyOperatorWebhookSchema)) body: MyOperatorWebhook,
  ): Promise<{ received: boolean; callId: string | null }> {
    const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(body);
    if (!this.myoperator.verifySignature(raw, signature)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
    if (!this.myoperator.webhookSecretConfigured()) {
      this.logger.warn('MYOPERATOR_WEBHOOK_SECRET not set — accepting webhook unverified (dev only)');
    }
    // Parse with THIS provider's adapter, then process (provider-agnostic).
    const result = await this.calls.processWebhookEvent(this.myoperator.parseEvent(body));
    return { received: true, callId: result.callId };
  }
}
