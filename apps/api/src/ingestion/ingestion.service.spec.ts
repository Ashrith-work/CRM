import { createHmac } from 'node:crypto';
import { IngestionService } from './ingestion.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import type { Env } from '../config/env';
import { ShopifyService } from './shopify.service';
import { Prisma } from '@prisma/client';

const SECRET = 'whsec_test';
const raw = JSON.stringify({ id: 555, order_number: 1042, total_price: '1234.50' });
const validHmac = createHmac('sha256', SECRET).update(raw).digest('base64');

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });
}

function build(createImpl: jest.Mock) {
  const add = jest.fn().mockResolvedValue({});
  const prisma = {
    integration: { findMany: jest.fn().mockResolvedValue([{ organizationId: 'org1', config: { shopDomain: 'nerige.myshopify.com' } }]) },
    webhookDelivery: { create: createImpl },
  } as unknown as PrismaService;
  const config = { get: jest.fn((k: string) => (k === 'SHOPIFY_WEBHOOK_SECRET' ? SECRET : undefined)) } as unknown as ConfigService<Env, true>;
  const service = new IngestionService(prisma, config, {} as ShopifyService, { add } as unknown as Queue);
  return { service, add };
}

const headers = { hmac: validHmac, topic: 'orders/create', webhookId: 'wh_1', shopDomain: 'nerige.myshopify.com' };

describe('IngestionService.handleWebhook (HMAC + dedup)', () => {
  it('rejects a bad HMAC before any DB touch', async () => {
    const create = jest.fn();
    const { service, add } = build(create);
    await expect(service.handleWebhook(raw, { ...headers, hmac: 'wrong' })).resolves.toBe('unauthorized');
    expect(create).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('accepts a valid delivery and enqueues exactly once', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'd1' });
    const { service, add } = build(create);
    await expect(service.handleWebhook(raw, headers)).resolves.toBe('ok');
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith('webhook', expect.objectContaining({ type: 'webhook', organizationId: 'org1', topic: 'orders/create' }), expect.anything());
  });

  it('same X-Shopify-Webhook-Id twice → duplicate, no second enqueue (one Order)', async () => {
    // 1st create succeeds, 2nd trips the unique constraint.
    const create = jest.fn().mockResolvedValueOnce({ id: 'd1' }).mockRejectedValueOnce(p2002());
    const { service, add } = build(create);

    await expect(service.handleWebhook(raw, headers)).resolves.toBe('ok');
    await expect(service.handleWebhook(raw, headers)).resolves.toBe('duplicate');
    expect(add).toHaveBeenCalledTimes(1); // only the first delivery did work
  });
});
