import { ActivityService } from './activity.service';
import type { PrismaService } from '../prisma/prisma.service';

describe('ActivityService.emit', () => {
  it('writes an ActivityEvent row with the mapped fields', async () => {
    const create = jest.fn().mockResolvedValue({});
    const prisma = { activityEvent: { create } } as unknown as PrismaService;
    const service = new ActivityService(prisma);

    await service.emit({
      organizationId: 'org1',
      entityType: 'CONTACT',
      entityId: 'c1',
      eventType: 'CREATED',
      actorId: 'u1',
      metadata: { foo: 'bar' },
      source: 'test',
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org1',
        entityType: 'CONTACT',
        entityId: 'c1',
        eventType: 'CREATED',
        actorId: 'u1',
        metadata: { foo: 'bar' },
        source: 'test',
      },
    });
  });

  it('never throws — timeline writes must not break the request path', async () => {
    const create = jest.fn().mockRejectedValue(new Error('db down'));
    const prisma = { activityEvent: { create } } as unknown as PrismaService;
    const service = new ActivityService(prisma);

    await expect(
      service.emit({ organizationId: 'org1', entityType: 'LEAD', entityId: 'l1', eventType: 'UPDATED' }),
    ).resolves.toBeUndefined();
  });
});
