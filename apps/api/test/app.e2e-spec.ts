import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PERMISSIONS, ROLE_PERMISSIONS, SYSTEM_ROLES } from '@crm/types';
import { MeController } from '../src/users/me.controller';
import { UsersService } from '../src/users/users.service';
import { AuditController } from '../src/audit/audit.controller';
import { ClerkAuthGuard } from '../src/auth/clerk-auth.guard';
import { ClerkService } from '../src/auth/clerk.service';
import { UserContextService } from '../src/auth/user-context.service';
import { PermissionsGuard } from '../src/rbac/permissions.guard';
import { PrismaService } from '../src/prisma/prisma.service';
import type { UserContext } from '../src/auth/auth.types';

/**
 * HTTP smoke test of the auth + RBAC path with Clerk and the DB stubbed:
 *   - anonymous            → 401
 *   - authenticated owner  → 200 on /me and /audit-logs
 *   - authenticated member → 200 on /me, 403 on /audit-logs (lacks audit:read)
 */
function contextFor(role: 'owner' | 'member'): UserContext {
  const permissions = [...ROLE_PERMISSIONS[SYSTEM_ROLES[role === 'owner' ? 'OWNER' : 'MEMBER']]];
  return {
    user: { id: `u_${role}`, clerkUserId: `clerk_${role}`, email: `${role}@acme.com`, firstName: null, lastName: null },
    organization: { id: 'org1', name: 'Acme', slug: 'acme' },
    team: { id: 't1', name: 'Core Team' },
    role: { id: `r_${role}`, name: role, permissions },
    permissions,
  };
}

describe('Auth + RBAC (e2e smoke)', () => {
  let app: INestApplication;

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
        clerkUserId === 'clerk_owner' ? contextFor('owner') : contextFor('member'),
    };
    const prismaStub = { auditLog: { findMany: jest.fn().mockResolvedValue([]) } };

    const moduleRef = await Test.createTestingModule({
      controllers: [MeController, AuditController],
      providers: [
        { provide: APP_GUARD, useClass: ClerkAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
        { provide: ClerkService, useValue: clerkStub },
        { provide: UserContextService, useValue: userCtxStub },
        { provide: PrismaService, useValue: prismaStub },
        { provide: UsersService, useValue: { setTimezone: jest.fn().mockResolvedValue('UTC') } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /me anonymous → 401', () => {
    return request(app.getHttpServer()).get('/me').expect(401);
  });

  it('GET /me with an invalid token → 401', () => {
    return request(app.getHttpServer())
      .get('/me')
      .set('Authorization', 'Bearer nope')
      .expect(401);
  });

  it('GET /me as owner → 200 with user/org/role', async () => {
    const res = await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', 'Bearer owner')
      .expect(200);
    expect(res.body.organization.slug).toBe('acme');
    expect(res.body.role.name).toBe('owner');
    expect(res.body.role.permissions).toContain(PERMISSIONS.USER_READ);
  });

  it('GET /me as member → 200', () => {
    return request(app.getHttpServer())
      .get('/me')
      .set('Authorization', 'Bearer member')
      .expect(200);
  });

  it('GET /audit-logs as owner → 200', () => {
    return request(app.getHttpServer())
      .get('/audit-logs')
      .set('Authorization', 'Bearer owner')
      .expect(200);
  });

  it('GET /audit-logs as member → 403 (lacks audit:read)', () => {
    return request(app.getHttpServer())
      .get('/audit-logs')
      .set('Authorization', 'Bearer member')
      .expect(403);
  });
});
