import { createHmac } from 'node:crypto';
import { ResendWebhookService } from './resend-webhook.service';
import type { PrismaService } from '../prisma/prisma.service';

function svc(secret?: string) {
  const send = { id: 's1', organizationId: 'org1' };
  const update = jest.fn().mockResolvedValue({});
  const upsert = jest.fn().mockResolvedValue({});
  const prisma = {
    campaignSend: { findFirst: jest.fn().mockResolvedValue(send), update },
    suppression: { upsert },
  } as unknown as PrismaService;
  const config = { get: () => secret } as never;
  return { service: new ResendWebhookService(prisma, config), update, upsert };
}

describe('ResendWebhookService', () => {
  it('opened → CampaignSend OPENED', async () => {
    const { service, update } = svc();
    await service.handle({ type: 'email.opened', data: { email_id: 'm1' } });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'OPENED' }) }));
  });

  it('bounced → BOUNCED status AND a BOUNCE suppression', async () => {
    const { service, update, upsert } = svc();
    await service.handle({ type: 'email.bounced', data: { email_id: 'm1', to: 'A@X.co' } });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'BOUNCED' }) }));
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ email: 'a@x.co', reason: 'BOUNCE' }) }));
  });

  it('complained → suppression only', async () => {
    const { service, upsert } = svc();
    await service.handle({ type: 'email.complained', data: { email_id: 'm1', to: 'a@x.co' } });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ reason: 'COMPLAINT' }) }));
  });

  it('verify: dev-lenient when no secret; strict HMAC when set', () => {
    expect(svc().service.verify(Buffer.from('{}'), undefined)).toBe(true);
    const raw = Buffer.from('{"type":"email.opened"}');
    const good = createHmac('sha256', 'shh').update(raw).digest('hex');
    expect(svc('shh').service.verify(raw, good)).toBe(true);
    expect(svc('shh').service.verify(raw, 'deadbeef')).toBe(false);
  });
});
