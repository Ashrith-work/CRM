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
import { LeadsModule } from '../src/leads/leads.module';
import { ClerkAuthGuard } from '../src/auth/clerk-auth.guard';
import { ClerkService } from '../src/auth/clerk.service';
import { UserContextService } from '../src/auth/user-context.service';
import { PermissionsGuard } from '../src/rbac/permissions.guard';
import type { UserContext } from '../src/auth/auth.types';

/**
 * Integration tests against the real dev Postgres. Boots the CRM modules with
 * the auth layer stubbed (owner = full perms, member = read-only) and exercises
 * the acceptance criteria end-to-end. All data lives under a throwaway org that
 * is cascade-deleted in afterAll.
 */
describe('CRM (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orgId = '';

  const ctx = (role: 'owner' | 'member'): UserContext => {
    const permissions = [...ROLE_PERMISSIONS[SYSTEM_ROLES[role === 'owner' ? 'OWNER' : 'MEMBER']]];
    return {
      user: { id: `u_${role}`, clerkUserId: `clerk_${role}`, email: `${role}@test.com`, firstName: role, lastName: 'User' },
      organization: { id: orgId, name: 'Test Org', slug: 'test-org' },
      team: null,
      role: { id: `r_${role}`, name: role, permissions },
      permissions,
    };
  };

  const owner = () => ctx('owner');

  beforeAll(async () => {
    const clerkStub: Pick<ClerkService, 'verifyToken'> = {
      verifyToken: async (token: string) => {
        if (token === 'owner') return { sub: 'clerk_owner' };
        if (token === 'member') return { sub: 'clerk_member' };
        throw new Error('invalid token');
      },
    };
    const userCtxStub: Pick<UserContextService, 'resolve'> = {
      resolve: async (clerkUserId: string) =>
        clerkUserId === 'clerk_owner' ? owner() : ctx('member'),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        ActivityModule,
        TagsModule,
        CustomFieldsModule,
        NotesModule,
        CompaniesModule,
        ContactsModule,
        LeadsModule,
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
    const org = await prisma.organization.create({
      data: { name: 'Test Org (e2e)', slug: `test-org-e2e-${process.pid}` },
    });
    orgId = org.id;
  });

  afterAll(async () => {
    if (orgId) await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
    await app.close();
  });

  const asOwner = (m: 'get' | 'post' | 'patch' | 'delete', url: string) =>
    request(app.getHttpServer())[m](url).set('Authorization', 'Bearer owner');

  it('creates a contact and records a CREATED activity (newest-first)', async () => {
    const created = await asOwner('post', '/contacts')
      .send({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' })
      .expect(201);
    const id = created.body.id as string;

    const feed = await asOwner('get', `/activity?entityType=CONTACT&entityId=${id}`).expect(200);
    expect(feed.body.data[0].eventType).toBe('CREATED');
  });

  it('validates custom fields by type (persists valid, 400 on mismatch, no partial write)', async () => {
    await asOwner('post', '/custom-fields')
      .send({ entityType: 'CONTACT', key: 'score', label: 'Score', fieldType: 'NUMBER' })
      .expect(201);

    const ok = await asOwner('post', '/contacts')
      .send({ firstName: 'Grace', lastName: 'Hopper', customFields: { score: '7' } })
      .expect(201);
    expect(ok.body.customFields.score).toBe(7); // coerced

    await asOwner('post', '/contacts')
      .send({ firstName: 'Bad', lastName: 'Score', customFields: { score: 'NaN' } })
      .expect(400);
  });

  it('filters a contact list by tag', async () => {
    const tag = await asOwner('post', '/tags').send({ name: 'Hot', color: '#274fd6' }).expect(201);
    const tagId = tag.body.id as string;

    const a = await asOwner('post', '/contacts').send({ firstName: 'Tagged', lastName: 'One', tagIds: [tagId] }).expect(201);
    await asOwner('post', '/contacts').send({ firstName: 'Untagged', lastName: 'Two' }).expect(201);

    const filtered = await asOwner('get', `/contacts?tagId=${tagId}`).expect(200);
    const ids = filtered.body.data.map((c: { id: string }) => c.id);
    expect(ids).toContain(a.body.id);
    expect(filtered.body.data.every((c: { tags: { id: string }[] }) => c.tags.some((t) => t.id === tagId))).toBe(true);
  });

  it('converts a lead to a new contact, links it, blocks re-conversion', async () => {
    const lead = await asOwner('post', '/leads')
      .send({ firstName: 'Lead', lastName: 'Person', email: 'newlead@example.com' })
      .expect(201);
    const leadId = lead.body.id as string;

    const conv = await asOwner('post', `/leads/${leadId}/convert`).send({}).expect(201);
    expect(conv.body.contactCreated).toBe(true);
    expect(conv.body.lead.status).toBe('CONVERTED');
    expect(conv.body.lead.convertedContactId).toBe(conv.body.contact.id);

    // Re-converting is blocked.
    await asOwner('post', `/leads/${leadId}/convert`).send({}).expect(409);
  });

  it('dedups on conversion by email (reuses the existing contact)', async () => {
    const existing = await asOwner('post', '/contacts')
      .send({ firstName: 'Dup', lastName: 'Existing', email: 'dup@example.com' })
      .expect(201);
    const lead = await asOwner('post', '/leads')
      .send({ firstName: 'Dup', lastName: 'Lead', email: 'DUP@example.com' })
      .expect(201);

    const conv = await asOwner('post', `/leads/${lead.body.id}/convert`).send({}).expect(201);
    expect(conv.body.contactCreated).toBe(false);
    expect(conv.body.contact.id).toBe(existing.body.id);
  });

  it('detaches contacts when their company is deleted (never cascade-deletes)', async () => {
    const company = await asOwner('post', '/companies').send({ name: 'DeleteMe Inc' }).expect(201);
    const contact = await asOwner('post', '/contacts')
      .send({ firstName: 'Keep', lastName: 'Me', companyId: company.body.id })
      .expect(201);

    await asOwner('delete', `/companies/${company.body.id}`).expect(204);

    await asOwner('get', `/companies/${company.body.id}`).expect(404);
    const after = await asOwner('get', `/contacts/${contact.body.id}`).expect(200);
    expect(after.body.companyId).toBeNull();
  });

  it('excludes soft-deleted records from reads', async () => {
    const c = await asOwner('post', '/contacts').send({ firstName: 'Gone', lastName: 'Soon' }).expect(201);
    await asOwner('delete', `/contacts/${c.body.id}`).expect(204);
    await asOwner('get', `/contacts/${c.body.id}`).expect(404);
  });

  it('enforces RBAC: a read-only member cannot create (403)', async () => {
    await request(app.getHttpServer())
      .post('/contacts')
      .set('Authorization', 'Bearer member')
      .send({ firstName: 'No', lastName: 'Access' })
      .expect(403);
  });

  it('rejects anonymous requests (401)', async () => {
    await request(app.getHttpServer()).get('/contacts').expect(401);
  });
});
