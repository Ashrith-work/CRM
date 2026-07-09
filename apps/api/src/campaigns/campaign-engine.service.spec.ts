import { PrismaClient } from '@prisma/client';
import { CampaignEngine } from './campaign-engine.service';
import { MarketingConsentGate } from './marketing-consent-gate.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { ResendAdapter } from '../messaging/resend.adapter';
import { makePii } from '../common/crypto.testkit';

jest.setTimeout(60_000); // DB-backed.

const prisma = new PrismaClient();
const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
const gate = new MarketingConsentGate(prisma as unknown as PrismaService, audit);
// A fake channel whose send() we swap per test to simulate success / outage.
const adapter = { channel: 'EMAIL' as const, send: jest.fn() };
const config = { get: (k: string) => ({ ABANDONED_CART_THRESHOLD_MINUTES: 60, APP_BASE_URL: 'http://x', UNSUBSCRIBE_SECRET: 'test' })[k] } as never;
const { pii } = makePii();
const engine = new CampaignEngine(prisma as unknown as PrismaService, gate, adapter as unknown as ResendAdapter, pii, config);

const SLUG = 'recovery-eng';
let orgId: string;
let campaignId: string;
let step1Id: string;
const H2 = () => new Date(Date.now() - 2 * 60 * 60_000); // checkout 2h ago → step1 (T+1h) due

async function customer(id: string, email: string, consent: 'GRANTED' | null, suppressed = false) {
  await prisma.customer.create({ data: { id: `${orgId}_${id}`, organizationId: orgId, externalId: `e_${id}`, email } });
  if (consent) await prisma.consent.create({ data: { organizationId: orgId, customerId: `${orgId}_${id}`, purpose: 'MARKETING', status: consent, source: 'SHOPIFY' } });
  if (suppressed) await prisma.suppression.create({ data: { organizationId: orgId, email, reason: 'UNSUBSCRIBE' } });
}
async function cart(id: string, custId: string, converted?: string) {
  return prisma.cart.create({ data: { id: `${orgId}_${id}`, organizationId: orgId, externalId: `chk_${id}`, customerId: `${orgId}_${custId}`, checkoutStartedAt: H2(), convertedOrderId: converted ?? null } });
}
async function enroll(cartId: string, custId: string, email: string) {
  return prisma.campaignEnrollment.create({ data: { organizationId: orgId, campaignId, cartId: `${orgId}_${cartId}`, customerId: `${orgId}_${custId}`, email, checkoutStartedAt: H2(), status: 'ACTIVE' } });
}

beforeAll(async () => {
  await prisma.organization.deleteMany({ where: { slug: SLUG } });
  const org = await prisma.organization.create({ data: { name: 'Recovery Eng', slug: SLUG } });
  orgId = org.id;
  const tmpl = await prisma.messageTemplate.create({ data: { organizationId: orgId, key: 'r1', version: 1, name: 'r1', subject: 'Come back {{email}}', bodyHtml: '<p>hi {{unsubscribe_url}}</p>', bodyText: 'hi {{unsubscribe_url}}' } });
  const campaign = await prisma.campaign.create({ data: { organizationId: orgId, name: 'Recovery', type: 'ABANDONED_CART', status: 'ACTIVE' } });
  campaignId = campaign.id;
  const s1 = await prisma.campaignStep.create({ data: { campaignId, stepOrder: 1, delayMinutes: 60, templateId: tmpl.id } });
  step1Id = s1.id;
  await prisma.campaignStep.create({ data: { campaignId, stepOrder: 2, delayMinutes: 1440, templateId: tmpl.id } });

  await customer('A', 'a@nerige.co', 'GRANTED');
  await customer('S', 's@nerige.co', 'GRANTED', true); // consented but suppressed
  await customer('N', 'n@nerige.co', null); // no consent
  // Carts for the enrollment sweep:
  await cart('sweepA', 'A');
  await cart('sweepS', 'S');
  await cart('sweepN', 'N');
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { slug: SLUG } });
  await prisma.$disconnect();
});

beforeEach(() => {
  (audit.record as jest.Mock).mockClear();
  adapter.send.mockReset();
});

describe('enrollment sweep', () => {
  it('enrolls only consented + non-suppressed abandoned carts, and is idempotent', async () => {
    adapter.send.mockResolvedValue({ providerMessageId: 'x' });
    const first = await engine.runEnrollmentSweep();
    const rows = await prisma.campaignEnrollment.findMany({ where: { organizationId: orgId }, include: {} });
    const emails = rows.map((r) => r.email).sort();
    expect(emails).toEqual(['a@nerige.co']); // S suppressed, N no-consent → excluded
    expect(first).toBe(1);
    // Second sweep enrolls nothing new (same cart not enrolled twice).
    expect(await engine.runEnrollmentSweep()).toBe(0);
    // cleanup so later tests start clean
    await prisma.campaignEnrollment.deleteMany({ where: { organizationId: orgId } });
  });
});

describe('send sweep', () => {
  it('fires the due step: SENT with the template version recorded', async () => {
    adapter.send.mockResolvedValue({ providerMessageId: 'prov_1' });
    const c = await cart('send', 'A');
    const e = await enroll('send', 'A', 'a@nerige.co');
    const did = await engine.processEnrollment(e);
    expect(did).toBe(true);
    expect(adapter.send).toHaveBeenCalledTimes(1);
    const send = await prisma.campaignSend.findFirst({ where: { enrollmentId: e.id } });
    expect(send).toMatchObject({ status: 'SENT', templateVersion: 1, providerMessageId: 'prov_1', campaignStepId: step1Id });
    void c;
  });

  it('HALTS ON PURCHASE: a converted cart stops all sends', async () => {
    adapter.send.mockResolvedValue({ providerMessageId: 'x' });
    await cart('halt', 'A', 'order_purchased'); // convertedOrderId set (M1 ingestion)
    const e = await enroll('halt', 'A', 'a@nerige.co');
    const did = await engine.processEnrollment(e);
    expect(did).toBe(false);
    expect(adapter.send).not.toHaveBeenCalled();
    const after = await prisma.campaignEnrollment.findUnique({ where: { id: e.id } });
    expect(after?.status).toBe('CONVERTED');
    expect(await prisma.campaignSend.count({ where: { enrollmentId: e.id } })).toBe(0);
  });

  it('consent withdrawn/suppressed mid-sequence → BLOCKED send + halt, no email', async () => {
    adapter.send.mockResolvedValue({ providerMessageId: 'x' });
    await cart('sup', 'S');
    const e = await enroll('sup', 'S', 's@nerige.co');
    const did = await engine.processEnrollment(e);
    expect(did).toBe(false);
    expect(adapter.send).not.toHaveBeenCalled();
    const after = await prisma.campaignEnrollment.findUnique({ where: { id: e.id } });
    expect(after?.status).toBe('HALTED');
    const send = await prisma.campaignSend.findFirst({ where: { enrollmentId: e.id } });
    expect(send?.status).toBe('BLOCKED');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'marketing.blocked' }));
  });

  it('provider outage → DELAYED (not failed), then retried to SENT', async () => {
    await cart('outage', 'A');
    const e = await enroll('outage', 'A', 'a@nerige.co');
    adapter.send.mockRejectedValueOnce(new Error('Resend 503'));
    expect(await engine.processEnrollment(e)).toBe(false);
    let send = await prisma.campaignSend.findFirst({ where: { enrollmentId: e.id } });
    expect(send?.status).toBe('DELAYED');
    expect((await prisma.campaignEnrollment.findUnique({ where: { id: e.id } }))?.status).toBe('ACTIVE');
    // Provider recovers → next tick retries the same step.
    adapter.send.mockResolvedValueOnce({ providerMessageId: 'prov_retry' });
    expect(await engine.processEnrollment(e)).toBe(true);
    send = await prisma.campaignSend.findFirst({ where: { enrollmentId: e.id } });
    expect(send?.status).toBe('SENT');
    expect(send?.providerMessageId).toBe('prov_retry');
  });
});
