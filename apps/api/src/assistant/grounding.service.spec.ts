import { GroundingService } from './grounding.service';

/**
 * Grounding retrieves glossary DEFINITIONS relevant to a question so the answer
 * can cite them. These tests exercise the in-memory fallback (no pgvector), and
 * prove embedGlossary degrades gracefully when the extension/table is absent.
 */
describe('GroundingService', () => {
  it('retrieves the most relevant glossary definition (in-memory fallback)', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValue(new Error('no pgvector')) };
    const svc = new GroundingService(prisma as never);
    const entries = await svc.retrieve('which customers are at risk of churning?');
    expect(entries.map((e) => e.metricKey)).toContain('churn_risk');
  });

  it('retrieves revenue for a revenue question', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValue(new Error('no pgvector')) };
    const svc = new GroundingService(prisma as never);
    const entries = await svc.retrieve('what is our net revenue?');
    expect(entries.map((e) => e.metricKey)).toContain('net_revenue');
  });

  it('embedGlossary swallows a missing-extension error and returns a count', async () => {
    const prisma = { $executeRaw: jest.fn().mockRejectedValue(new Error('type "vector" does not exist')) };
    const svc = new GroundingService(prisma as never);
    await expect(svc.embedGlossary()).resolves.toBe(0);
  });
});
