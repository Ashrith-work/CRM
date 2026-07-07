import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import type { UserContext } from '../auth/auth.types';

function buildContext(
  userContext: UserContext | undefined,
  required: string[] | undefined,
): { ctx: ExecutionContext; reflector: Reflector } {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(required),
  } as unknown as Reflector;
  const ctx = {
    switchToHttp: () => ({ getRequest: () => ({ userContext }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
  return { ctx, reflector };
}

const memberContext: UserContext = {
  user: { id: 'u1', clerkUserId: 'c1', email: 'm@b.com', firstName: null, lastName: null },
  organization: { id: 'org1', name: 'Acme', slug: 'acme' },
  team: null,
  role: { id: 'r1', name: 'member', permissions: ['user:read', 'team:read', 'org:read'] },
  permissions: ['user:read', 'team:read', 'org:read'],
};

describe('PermissionsGuard', () => {
  it('allows routes with no required permissions', () => {
    const { ctx, reflector } = buildContext(memberContext, undefined);
    expect(new PermissionsGuard(reflector).canActivate(ctx)).toBe(true);
  });

  it('allows when the user has all required permissions', () => {
    const { ctx, reflector } = buildContext(memberContext, ['user:read']);
    expect(new PermissionsGuard(reflector).canActivate(ctx)).toBe(true);
  });

  it('denies (403) with a machine code FORBIDDEN when missing a permission', () => {
    const { ctx, reflector } = buildContext(memberContext, ['audit:read']);
    try {
      new PermissionsGuard(reflector).canActivate(ctx);
      throw new Error('expected a ForbiddenException');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    }
  });

  it('requires ALL listed permissions (least privilege)', () => {
    const { ctx, reflector } = buildContext(memberContext, ['user:read', 'user:manage']);
    expect(() => new PermissionsGuard(reflector).canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('denies when user context is missing', () => {
    const { ctx, reflector } = buildContext(undefined, ['user:read']);
    expect(() => new PermissionsGuard(reflector).canActivate(ctx)).toThrow(ForbiddenException);
  });
});
