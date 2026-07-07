import { ReminderSweepProcessor } from './reminder-sweep.processor';
import type { PrismaService } from '../prisma/prisma.service';
import type { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import type { Env } from '../config/env';

describe('ReminderSweepProcessor', () => {
  it('claims each due+SCHEDULED reminder atomically and enqueues one send job keyed by id', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);
    // r1 claimed by us (count 1); r2 already claimed elsewhere (count 0).
    const updateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const prisma = { reminder: { findMany, updateMany } } as unknown as PrismaService;
    const config = {} as ConfigService<Env, true>;
    const sweepQueue = { add: jest.fn() } as unknown as Queue;
    const add = jest.fn().mockResolvedValue({});
    const sendQueue = { add } as unknown as Queue;

    const processor = new ReminderSweepProcessor(prisma, config, sweepQueue, sendQueue);
    const result = await processor.process();

    // Only selects due & scheduled reminders.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'SCHEDULED' }) }),
    );
    // Exactly one send job enqueued (for the reminder we claimed), keyed for idempotency.
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      'send',
      { reminderId: 'r1' },
      expect.objectContaining({ jobId: 'send:r1' }),
    );
    expect(result).toEqual({ claimed: 1 });
  });

  it('does nothing when no reminders are due', async () => {
    const prisma = {
      reminder: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
    } as unknown as PrismaService;
    const add = jest.fn();
    const processor = new ReminderSweepProcessor(
      prisma,
      {} as ConfigService<Env, true>,
      { add: jest.fn() } as unknown as Queue,
      { add } as unknown as Queue,
    );

    expect(await processor.process()).toEqual({ claimed: 0 });
    expect(add).not.toHaveBeenCalled();
  });
});
