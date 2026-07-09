import { AssistantService } from './assistant.service';
import { answerCacheKey } from './assistant.constants';
import { PERMISSIONS } from '@crm/types';
import type { UserContext } from '../auth/auth.types';

function makeUser(permissions: string[]): UserContext {
  return {
    user: { id: 'user_1', clerkUserId: 'clerk_1', email: 'u@x.co', firstName: null, lastName: null },
    organization: { id: 'org_1', name: 'Org', slug: 'org' },
    team: null,
    role: { id: 'r', name: 'member', permissions },
    permissions,
  };
}

function build(overrides: {
  cacheGet?: jest.Mock;
  run?: jest.Mock;
} = {}) {
  const cacheGet = overrides.cacheGet ?? jest.fn().mockResolvedValue(null);
  const cacheSet = jest.fn().mockResolvedValue(undefined);
  const run =
    overrides.run ??
    jest.fn().mockResolvedValue({
      answer: 'Champions lead your RFM mix.',
      toolsUsed: [{ tool: 'rfm_summary', args: {}, rowCount: 3 }],
      metricKeys: ['rfm'],
      segmentHandoff: null,
      declinedAction: false,
    });
  const aiQueryCreate = jest.fn().mockResolvedValue({});
  const auditLogCreate = jest.fn().mockResolvedValue({});
  const prisma = { aiQuery: { create: aiQueryCreate }, auditLog: { create: auditLogCreate } };
  const redis = { cacheGet, cacheSet };
  const grounding = { retrieve: jest.fn().mockResolvedValue([]) };
  const orchestrator = { run };
  const config = { get: jest.fn().mockReturnValue(300) };
  const svc = new AssistantService(
    prisma as never,
    redis as never,
    grounding as never,
    orchestrator as never,
    {} as never,
    {} as never,
    {} as never,
    config as never,
  );
  return { svc, cacheGet, cacheSet, run, aiQueryCreate, auditLogCreate };
}

describe('AssistantService', () => {
  it('answers, cites the glossary, caches, and audits (cache miss path)', async () => {
    const { svc, cacheSet, run, aiQueryCreate, auditLogCreate } = build();
    const res = await svc.ask(makeUser([PERMISSIONS.AI_QUERY]), 'What is our RFM mix?');
    expect(res.cached).toBe(false);
    expect(res.citations.map((c) => c.metricKey)).toEqual(['rfm']); // every metric cites the ONE glossary
    expect(run).toHaveBeenCalledTimes(1);
    expect(cacheSet).toHaveBeenCalledTimes(1);
    expect(aiQueryCreate).toHaveBeenCalledTimes(1); // AiQuery audit row
    expect(auditLogCreate).toHaveBeenCalledTimes(1); // AuditLog row
  });

  it('serves a repeated question from cache without re-running the orchestrator', async () => {
    const cached = {
      answer: 'cached answer',
      citations: [],
      toolsUsed: [{ tool: 'rfm_summary', args: {}, rowCount: 3 }],
      segmentHandoff: null,
      declinedAction: false,
      cached: false,
      answeredAt: '2026-07-09T00:00:00.000Z',
    };
    const { svc, run, aiQueryCreate } = build({ cacheGet: jest.fn().mockResolvedValue(cached) });
    const res = await svc.ask(makeUser([PERMISSIONS.AI_QUERY]), 'What is our RFM mix?');
    expect(res.cached).toBe(true);
    expect(run).not.toHaveBeenCalled(); // no recompute, no model spend
    expect(aiQueryCreate).toHaveBeenCalledTimes(1); // cache hits are still audited
  });

  it('the audit stores tool names/args only — never the answer text or customer data', async () => {
    const { svc, aiQueryCreate } = build();
    await svc.ask(makeUser([PERMISSIONS.AI_QUERY]), 'What is our RFM mix?');
    const stored = aiQueryCreate.mock.calls[0][0].data;
    expect(JSON.stringify(stored.toolsCalled)).not.toContain('Champions'); // answer text isn't audited
    expect(stored.toolsCalled).toEqual([{ tool: 'rfm_summary', args: {}, rowCount: 3 }]);
  });
});

describe('answerCacheKey (RBAC isolation)', () => {
  it('gives different roles different keys — a member never shares an admin cache entry', () => {
    const member = answerCacheKey({ organizationId: 'org_1', permissions: ['ai:query', 'analytics:read'], question: 'top customers' });
    const admin = answerCacheKey({ organizationId: 'org_1', permissions: ['ai:query', 'analytics:read', 'pii:read'], question: 'top customers' });
    expect(member).not.toBe(admin);
  });

  it('isolates orgs', () => {
    const a = answerCacheKey({ organizationId: 'org_a', permissions: ['ai:query'], question: 'top customers' });
    const b = answerCacheKey({ organizationId: 'org_b', permissions: ['ai:query'], question: 'top customers' });
    expect(a).not.toBe(b);
  });

  it('normalizes whitespace/case so trivially-different phrasings share a cache entry', () => {
    const a = answerCacheKey({ organizationId: 'org_1', permissions: ['ai:query'], question: 'Top   Customers' });
    const b = answerCacheKey({ organizationId: 'org_1', permissions: ['ai:query'], question: 'top customers' });
    expect(a).toBe(b);
  });
});
