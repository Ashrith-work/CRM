import { ExecutionContext, ForbiddenException, Logger, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClerkAuthGuard } from './clerk-auth.guard';
import { ClerkService, TokenVerificationFailure } from './clerk.service';
import type { UserContextService } from './user-context.service';
import type { UserContext } from './auth.types';

function buildContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

const fakeContext: UserContext = {
  user: { id: 'u1', clerkUserId: 'clerk_1', email: 'a@b.com', firstName: 'A', lastName: 'B' },
  organization: { id: 'org1', name: 'Acme', slug: 'acme' },
  team: null,
  role: { id: 'r1', name: 'owner', permissions: ['user:read'] },
  permissions: ['user:read'],
};

describe('ClerkAuthGuard', () => {
  let reflector: Reflector;
  let clerk: jest.Mocked<Pick<ClerkService, 'verifyToken'>>;
  let userContext: jest.Mocked<Pick<UserContextService, 'resolve'>>;
  let guard: ClerkAuthGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) } as unknown as Reflector;
    clerk = { verifyToken: jest.fn() };
    userContext = { resolve: jest.fn() };
    guard = new ClerkAuthGuard(
      reflector,
      clerk as unknown as ClerkService,
      userContext as unknown as UserContextService,
    );
  });

  it('allows public routes without a token', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(true);
    const ctx = buildContext({ headers: {} });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(clerk.verifyToken).not.toHaveBeenCalled();
  });

  it('rejects a request with no bearer token (401, logged "missing")', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const ctx = buildContext({ headers: {}, method: 'GET', url: '/api/v1/contacts' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('401 missing'));
    warn.mockRestore();
  });

  it('rejects an expired token (401) and logs the reason as "expired"', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    clerk.verifyToken.mockRejectedValue(new TokenVerificationFailure('expired', 'token-expired'));
    const ctx = buildContext({ headers: { authorization: 'Bearer expired' }, method: 'GET', url: '/api/v1/contacts' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('401 expired'));
    warn.mockRestore();
  });

  it('rejects a tampered token (401) and logs "invalid-signature"', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    clerk.verifyToken.mockRejectedValue(new TokenVerificationFailure('invalid-signature', 'token-invalid-signature'));
    const ctx = buildContext({ headers: { authorization: 'Bearer tampered' }, method: 'GET', url: '/api/v1/contacts' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('401 invalid-signature'));
    warn.mockRestore();
  });

  it('rejects a valid token for an unprovisioned user (403)', async () => {
    clerk.verifyToken.mockResolvedValue({ sub: 'clerk_1' });
    userContext.resolve.mockResolvedValue(null);
    const ctx = buildContext({ headers: { authorization: 'Bearer good' } });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('attaches auth + userContext for a valid token', async () => {
    clerk.verifyToken.mockResolvedValue({ sub: 'clerk_1', org_id: 'org_ext', sid: 'sess_1' });
    userContext.resolve.mockResolvedValue(fakeContext);
    const request: Record<string, unknown> = { headers: { authorization: 'Bearer good' } };
    const ctx = buildContext(request);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.auth).toEqual({
      clerkUserId: 'clerk_1',
      clerkOrgId: 'org_ext',
      sessionId: 'sess_1',
    });
    expect(request.userContext).toBe(fakeContext);
  });
});
