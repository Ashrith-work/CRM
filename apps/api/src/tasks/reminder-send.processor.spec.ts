import { ReminderSendProcessor } from './reminder-send.processor';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationService } from '../notifications/notification.service';
import type { Job } from 'bullmq';

function job(reminderId: string): Job<{ reminderId: string }> {
  return { data: { reminderId } } as unknown as Job<{ reminderId: string }>;
}

const openTask = {
  id: 'task1',
  organizationId: 'org1',
  title: 'Pricing call',
  status: 'OPEN',
  assigneeId: 'u2',
  relatedType: 'DEAL',
  relatedId: 'd1',
  dueAt: new Date('2026-07-10T13:00:00.000Z'),
  startAt: null,
  deletedAt: null,
};

describe('ReminderSendProcessor', () => {
  it('fans out a REMINDER to the task’s CURRENT assignee on the reminder’s channels', async () => {
    const prisma = {
      reminder: {
        findUnique: jest.fn().mockResolvedValue({ id: 'r1', channels: ['IN_APP', 'EMAIL'], task: openTask }),
      },
    } as unknown as PrismaService;
    const fanOut = jest.fn().mockResolvedValue({});
    const notifications = { fanOut } as unknown as NotificationService;

    const processor = new ReminderSendProcessor(prisma, notifications);
    const result = await processor.process(job('r1'));

    expect(fanOut).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org1',
        userId: 'u2', // current assignee → reassignment redirects here
        type: 'REMINDER',
        taskId: 'task1',
        channels: ['IN_APP', 'EMAIL'],
      }),
    );
    expect(result).toEqual({ delivered: true });
  });

  it('skips reminders for a DONE/CANCELLED task', async () => {
    const prisma = {
      reminder: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'r1', channels: ['IN_APP'], task: { ...openTask, status: 'DONE' } }),
      },
    } as unknown as PrismaService;
    const fanOut = jest.fn();
    const processor = new ReminderSendProcessor(prisma, { fanOut } as unknown as NotificationService);

    expect(await processor.process(job('r1'))).toEqual({ delivered: false });
    expect(fanOut).not.toHaveBeenCalled();
  });

  it('skips a missing reminder', async () => {
    const prisma = {
      reminder: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const fanOut = jest.fn();
    const processor = new ReminderSendProcessor(prisma, { fanOut } as unknown as NotificationService);

    expect(await processor.process(job('gone'))).toEqual({ delivered: false });
    expect(fanOut).not.toHaveBeenCalled();
  });
});
