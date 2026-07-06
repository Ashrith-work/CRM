import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor';
import type { AuditService } from './audit.service';
import type { UserContext } from '../auth/auth.types';

const userContext: UserContext = {
  user: { id: 'u1', clerkUserId: 'c1', email: 'a@b.com', firstName: null, lastName: null },
  organization: { id: 'org1', name: 'Acme', slug: 'acme' },
  team: null,
  role: { id: 'r1', name: 'owner', permissions: [] },
  permissions: [],
};

function buildContext(method: string): ExecutionContext {
  const request = {
    method,
    userContext,
    ip: '127.0.0.1',
    headers: { 'user-agent': 'jest' },
    route: { path: '/teams' },
    url: '/teams',
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function callHandler(body: unknown): CallHandler {
  return { handle: () => of(body) };
}

describe('AuditInterceptor', () => {
  let audit: jest.Mocked<Pick<AuditService, 'record'>>;
  let interceptor: AuditInterceptor;

  beforeEach(() => {
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    interceptor = new AuditInterceptor(audit as unknown as AuditService);
  });

  it('does not audit read (GET) requests', async () => {
    const result = interceptor.intercept(buildContext('GET'), callHandler({ ok: true }));
    await lastValueFrom(result);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('audits mutating (POST) requests after success', async () => {
    const result = interceptor.intercept(buildContext('POST'), callHandler({ id: 't1' }));
    await lastValueFrom(result);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org1',
        actorUserId: 'u1',
        actorClerkUserId: 'c1',
        action: 'create',
        entity: '/teams',
        after: { id: 't1' },
      }),
    );
  });

  it('maps DELETE to the delete action', async () => {
    const result = interceptor.intercept(buildContext('DELETE'), callHandler(null));
    await lastValueFrom(result);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'delete' }));
  });
});
