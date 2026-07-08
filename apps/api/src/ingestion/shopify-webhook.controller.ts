import { Body, Controller, Headers, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { IngestionService } from './ingestion.service';

/**
 * Public Shopify webhook. HMAC is verified over the RAW body BEFORE any parse/DB
 * touch; a bad signature → 401. Otherwise it dedups on X-Shopify-Webhook-Id and
 * acks fast (heavy work runs in the worker). `@Body` is only used as a fallback
 * shape — the RAW body drives HMAC + processing.
 */
@Controller('webhooks')
export class ShopifyWebhookController {
  constructor(private readonly ingestion: IngestionService) {}

  @Post('shopify')
  @Public()
  @HttpCode(200)
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-shopify-hmac-sha256') hmac: string | undefined,
    @Headers('x-shopify-topic') topic: string | undefined,
    @Headers('x-shopify-webhook-id') webhookId: string | undefined,
    @Headers('x-shopify-shop-domain') shopDomain: string | undefined,
    @Body() body: unknown,
  ): Promise<{ received: boolean; status: string }> {
    const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(body ?? {});
    const outcome = await this.ingestion.handleWebhook(raw, { hmac, topic, webhookId, shopDomain });
    if (outcome === 'unauthorized') throw new UnauthorizedException('Invalid webhook signature');
    return { received: true, status: outcome }; // ok | duplicate | ignored → 200
  }
}
