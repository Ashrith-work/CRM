import { IntegrationsService } from './integrations.service';
import type { PrismaService } from '../prisma/prisma.service';

describe('IntegrationsService', () => {
  it('connect upserts on (org, provider) and marks CONNECTED with the actor', async () => {
    const upsert = jest.fn().mockImplementation(({ create }) => ({
      id: 'int1',
      organizationId: 'org1',
      provider: create.provider,
      status: 'CONNECTED',
      externalAccountId: create.externalAccountId ?? null,
      config: create.config ?? {},
      connectedById: create.connectedById,
      connectedAt: new Date('2026-07-01T00:00:00Z'),
      createdAt: new Date('2026-07-01T00:00:00Z'),
      updatedAt: new Date('2026-07-01T00:00:00Z'),
    }));
    const prisma = { integration: { upsert } } as unknown as PrismaService;
    const service = new IntegrationsService(prisma);

    const result = await service.connect('org1', 'admin1', { provider: 'MYOPERATOR', config: { callerId: '+91' } });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId_provider: { organizationId: 'org1', provider: 'MYOPERATOR' } } }),
    );
    expect(result).toMatchObject({ provider: 'MYOPERATOR', status: 'CONNECTED', connectedById: 'admin1' });
  });

  it('disconnect flips status to DISCONNECTED', async () => {
    const row = { id: 'int1', organizationId: 'org1', provider: 'MYOPERATOR', status: 'DISCONNECTED', externalAccountId: null, config: {}, connectedById: 'admin1', connectedAt: null, createdAt: new Date(), updatedAt: new Date() };
    const prisma = {
      integration: {
        findFirst: jest.fn().mockResolvedValue(row),
        update: jest.fn().mockResolvedValue(row),
      },
    } as unknown as PrismaService;
    const service = new IntegrationsService(prisma);

    const result = await service.disconnect('org1', 'int1');
    expect(result.status).toBe('DISCONNECTED');
  });
});
