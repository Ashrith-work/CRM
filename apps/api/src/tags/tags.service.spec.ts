import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TagsService } from './tags.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ActivityService } from '../activity/activity.service';

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('TagsService', () => {
  it('maps a unique-constraint violation to 409 (tag name uniqueness)', async () => {
    const prisma = { tag: { create: jest.fn().mockRejectedValue(p2002()) } } as unknown as PrismaService;
    const activity = { emit: jest.fn() } as unknown as ActivityService;
    const service = new TagsService(prisma, activity);

    await expect(service.create('org1', { name: 'VIP', color: '#274fd6' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('setEntityTags adds only new valid tags, removes stale ones, and emits TAG_ADDED', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      tag: { findMany: jest.fn().mockResolvedValue([{ id: 't1' }, { id: 't2' }]) },
      taggable: {
        findMany: jest.fn().mockResolvedValue([{ tagId: 't2' }, { tagId: 't3' }]),
        deleteMany,
        createMany,
      },
    } as unknown as PrismaService;
    const emit = jest.fn().mockResolvedValue(undefined);
    const activity = { emit } as unknown as ActivityService;
    const service = new TagsService(prisma, activity);

    // Request t1,t2,bad → valid are t1,t2; current are t2,t3.
    await service.setEntityTags('org1', 'CONTACT', 'c1', ['t1', 't2', 'bad'], 'u1');

    expect(deleteMany).toHaveBeenCalledWith({
      where: { organizationId: 'org1', entityType: 'CONTACT', entityId: 'c1', tagId: { in: ['t3'] } },
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [{ organizationId: 'org1', tagId: 't1', entityType: 'CONTACT', entityId: 'c1' }],
      skipDuplicates: true,
    });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'TAG_ADDED', entityId: 'c1', metadata: { tagId: 't1' } }),
    );
  });
});
