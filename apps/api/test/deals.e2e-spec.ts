import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ROLE_PERMISSIONS, SYSTEM_ROLES } from '@crm/types';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ActivityModule } from '../src/activity/activity.module';
import { TagsModule } from '../src/tags/tags.module';
import { CustomFieldsModule } from '../src/custom-fields/custom-fields.module';
import { NotesModule } from '../src/notes/notes.module';
import { CompaniesModule } from '../src/companies/companies.module';
import { ContactsModule } from '../src/contacts/contacts.module';
import { StagesModule } from '../src/stages/stages.module';
import { PipelinesModule } from '../src/pipelines/pipelines.module';
import { DealsModule } from '../src/deals/deals.module';
import { ClerkAuthGuard } from '../src/auth/clerk-auth.guard';
import { ClerkService } from '../src/auth/clerk.service';
import { UserContextService } from '../src/auth/user-context.service';
import { PermissionsGuard } from '../src/rbac/permissions.guard';
import type { UserContext } from '../src/auth/auth.types';

/** Integration tests for the M2 revenue layer against the real dev Postgres. */
describe('Deals / Pipelines (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orgId = '';

  const stageId: Record<string, string> = {};
  let pipelineId = '';
  let contactId = '';
  let companyId = '';
  let dealId = '';

  const ctx = (role: 'owner' | 'member'): UserContext => {
    const permissions = [...ROLE_PERMISSIONS[SYSTEM_ROLES[role === 'owner' ? 'OWNER' : 'MEMBER']]];
    return {
      user: { id: `u_${role}`, clerkUserId: `clerk_${role}`, email: `${role}@t.com`, firstName: role, lastName: 'U' },
      organization: { id: orgId, name: 'T', slug: 't' },
      team: null,
      role: { id: `r_${role}`, name: role, permissions },
      permissions,
    };
  };

  const asOwner = (m: 'get' | 'post' | 'patch' | 'delete', url: string) =>
    request(app.getHttpServer())[m](url).set('Authorization', 'Bearer owner');

  beforeAll(async () => {
    const clerkStub: Pick<ClerkService, 'verifyToken'> = {
      verifyToken: async (t: string) => {
        if (t === 'owner') return { sub: 'clerk_owner' };
        if (t === 'member') return { sub: 'clerk_member' };
        throw new Error('invalid');
      },
    };
    const userCtxStub: Pick<UserContextService, 'resolve'> = {
      resolve: async (id: string) => (id === 'clerk_owner' ? ctx('owner') : ctx('member')),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule, ActivityModule, TagsModule, CustomFieldsModule, NotesModule,
        CompaniesModule, ContactsModule, StagesModule, PipelinesModule, DealsModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: ClerkAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
        { provide: ClerkService, useValue: clerkStub },
        { provide: UserContextService, useValue: userCtxStub },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const org = await prisma.organization.create({ data: { name: 'Deals e2e', slug: `deals-e2e-${process.pid}` } });
    orgId = org.id;

    const pipeline = await asOwner('post', '/pipelines').send({ name: 'Sales', isDefault: true }).expect(201);
    pipelineId = pipeline.body.id;
    for (const s of [
      { name: 'New', probability: 10, type: 'OPEN' },
      { name: 'Qualified', probability: 30, type: 'OPEN' },
      { name: 'Won', probability: 100, type: 'WON' },
      { name: 'Lost', probability: 0, type: 'LOST' },
    ]) {
      const res = await asOwner('post', '/stages').send({ pipelineId, ...s }).expect(201);
      stageId[s.name] = res.body.id;
    }

    const company = await asOwner('post', '/companies').send({ name: 'Acme Co' }).expect(201);
    companyId = company.body.id;
    const contact = await asOwner('post', '/contacts').send({ firstName: 'Deal', lastName: 'Owner', email: 'deal@x.com', phone: '+1' }).expect(201);
    contactId = contact.body.id;
  });

  afterAll(async () => {
    if (orgId) await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
    await app.close();
  });

  it('creates a deal (money as integer minor units) linked to a contact/company; it lands in the first stage', async () => {
    const res = await asOwner('post', '/deals')
      .send({ name: 'Big deal', pipelineId, amountMinor: 4_500_000, currency: 'USD', contactId, companyId })
      .expect(201);
    dealId = res.body.id;
    expect(res.body.amountMinor).toBe(4_500_000);
    expect(Number.isInteger(res.body.amountMinor)).toBe(true);
    expect(res.body.stageId).toBe(stageId.New);
    expect(res.body.status).toBe('OPEN');

    // Shows in the contact's Deals section (filter by contactId).
    const byContact = await asOwner('get', `/deals?contactId=${contactId}`).expect(200);
    expect(byContact.body.data.map((d: { id: string }) => d.id)).toContain(dealId);
  });

  it('board places the deal in the right column with count/sum/weighted totals', async () => {
    const board = await asOwner('get', `/pipelines/${pipelineId}/board`).expect(200);
    const col = board.body.columns.find((c: { stage: { name: string } }) => c.stage.name === 'New');
    expect(col.totals.count).toBe(1);
    expect(col.totals.sumMinor).toBe(4_500_000);
    expect(col.totals.weightedMinor).toBe(450_000); // 4.5M * 10%
    expect(col.deals.map((d: { id: string }) => d.id)).toContain(dealId);
  });

  it('moves a deal across stages: persists, writes StageHistory (+seconds), emits STAGE_CHANGED, mirrors to contact timeline, totals update', async () => {
    await asOwner('post', `/deals/${dealId}/move`).send({ toStageId: stageId.Qualified }).expect(201);

    const deal = await asOwner('get', `/deals/${dealId}`).expect(200);
    expect(deal.body.stageId).toBe(stageId.Qualified);

    const history = await asOwner('get', `/deals/${dealId}/history`).expect(200);
    const last = history.body.data[history.body.data.length - 1];
    expect(last.toStageId).toBe(stageId.Qualified);
    expect(typeof last.secondsInPreviousStage).toBe('number');

    const dealFeed = await asOwner('get', `/activity?entityType=DEAL&entityId=${dealId}`).expect(200);
    expect(dealFeed.body.data.some((e: { eventType: string }) => e.eventType === 'STAGE_CHANGED')).toBe(true);

    // Deal action appears on the linked contact's timeline.
    const contactFeed = await asOwner('get', `/activity?entityType=CONTACT&entityId=${contactId}`).expect(200);
    expect(contactFeed.body.data.some((e: { eventType: string }) => e.eventType === 'STAGE_CHANGED')).toBe(true);

    const board = await asOwner('get', `/pipelines/${pipelineId}/board`).expect(200);
    const q = board.body.columns.find((c: { stage: { name: string } }) => c.stage.name === 'Qualified');
    expect(q.totals.count).toBe(1);
    expect(q.totals.weightedMinor).toBe(1_350_000); // 4.5M * 30%
  });

  it('moving to a WON stage sets status=WON + closedAt + WON activity; re-moving is blocked; reopen returns it to open', async () => {
    const won = await asOwner('post', `/deals/${dealId}/move`).send({ toStageId: stageId.Won }).expect(201);
    expect(won.body.status).toBe('WON');
    expect(won.body.closedAt).not.toBeNull();

    const feed = await asOwner('get', `/activity?entityType=DEAL&entityId=${dealId}`).expect(200);
    expect(feed.body.data.some((e: { eventType: string }) => e.eventType === 'WON')).toBe(true);

    // A WON deal cannot be moved without reopening.
    await asOwner('post', `/deals/${dealId}/move`).send({ toStageId: stageId.Qualified }).expect(409);

    const reopened = await asOwner('post', `/deals/${dealId}/reopen`).send({}).expect(201);
    expect(reopened.body.status).toBe('OPEN');
  });

  it('filters deals by stage and owner', async () => {
    await asOwner('post', '/deals').send({ name: 'Second', pipelineId, amountMinor: 1000 }).expect(201);
    const inNew = await asOwner('get', `/deals?stageId=${stageId.New}`).expect(200);
    expect(inNew.body.data.length).toBeGreaterThanOrEqual(1);
    expect(inNew.body.data.every((d: { stageId: string }) => d.stageId === stageId.New)).toBe(true);

    const mine = await asOwner('get', '/deals?ownerId=u_owner').expect(200);
    expect(mine.body.data.every((d: { ownerId: string }) => d.ownerId === 'u_owner')).toBe(true);
  });

  it('blocks deleting a stage or pipeline that still holds deals', async () => {
    await asOwner('delete', `/stages/${stageId.New}`).expect(409);
    await asOwner('delete', `/pipelines/${pipelineId}`).expect(409);
  });

  it('enforces RBAC: a read-only member cannot create a deal (403)', async () => {
    await request(app.getHttpServer())
      .post('/deals')
      .set('Authorization', 'Bearer member')
      .send({ name: 'nope', pipelineId })
      .expect(403);
  });
});
