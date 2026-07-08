import { ReminderService, taskAnchor } from './reminder.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { Task as TaskRow } from '@prisma/client';

function taskRow(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 'task1',
    organizationId: 'org1',
    type: 'FOLLOW_UP',
    title: 'Follow up',
    description: null,
    status: 'OPEN',
    priority: 'MEDIUM',
    dueAt: new Date('2026-07-10T13:00:00.000Z'),
    startAt: null,
    endAt: null,
    location: null,
    meetingUrl: null,
    assigneeId: 'u1',
    createdById: 'u1',
    relatedType: null,
    relatedId: null,
    completedAt: null,
    outcome: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe('ReminderService', () => {
  it('taskAnchor prefers startAt (meetings) then falls back to dueAt', () => {
    const start = new Date('2026-07-10T10:00:00.000Z');
    expect(taskAnchor({ startAt: start, dueAt: new Date() })).toBe(start);
    const due = new Date('2026-07-10T13:00:00.000Z');
    expect(taskAnchor({ startAt: null, dueAt: due })).toBe(due);
    expect(taskAnchor({ startAt: null, dueAt: null })).toBeNull();
  });

  it('syncForTask cancels pending reminders then inserts offsets relative to the anchor', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const createMany = jest.fn().mockResolvedValue({ count: 2 });
    const prisma = { reminder: { updateMany, createMany } } as unknown as PrismaService;
    const service = new ReminderService(prisma);

    await service.syncForTask(taskRow(), [
      { minutesBefore: 15 },
      { minutesBefore: 60, channels: ['EMAIL'] },
    ]);

    // Cancellation of the currently-scheduled rows.
    expect(updateMany).toHaveBeenCalledWith({
      where: { organizationId: 'org1', taskId: 'task1', status: 'SCHEDULED' },
      data: { status: 'CANCELLED' },
    });
    // remindAt = dueAt − minutesBefore; default channels when omitted.
    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          organizationId: 'org1',
          taskId: 'task1',
          remindAt: new Date('2026-07-10T12:45:00.000Z'),
          channels: ['IN_APP', 'EMAIL', 'PUSH'],
        },
        {
          organizationId: 'org1',
          taskId: 'task1',
          remindAt: new Date('2026-07-10T12:00:00.000Z'),
          channels: ['EMAIL'],
        },
      ],
    });
  });

  it('syncForTask with no anchor cancels but creates nothing', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const createMany = jest.fn();
    const prisma = { reminder: { updateMany, createMany } } as unknown as PrismaService;
    const service = new ReminderService(prisma);

    await service.syncForTask(taskRow({ dueAt: null, startAt: null }), [{ minutesBefore: 15 }]);

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('shiftForTask preserves each reminder offset when the anchor moves', async () => {
    const pending = [
      { id: 'r1', remindAt: new Date('2026-07-10T12:45:00.000Z') },
      { id: 'r2', remindAt: new Date('2026-07-10T12:00:00.000Z') },
    ];
    const update = jest.fn().mockImplementation((args) => args);
    const prisma = {
      reminder: { findMany: jest.fn().mockResolvedValue(pending), update },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    } as unknown as PrismaService;
    const service = new ReminderService(prisma);

    // Move the anchor forward by 2 hours.
    const oldAnchor = new Date('2026-07-10T13:00:00.000Z');
    const newAnchor = new Date('2026-07-10T15:00:00.000Z');
    await service.shiftForTask('org1', 'task1', oldAnchor, newAnchor);

    expect(update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { remindAt: new Date('2026-07-10T14:45:00.000Z') },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'r2' },
      data: { remindAt: new Date('2026-07-10T14:00:00.000Z') },
    });
  });

  it('snoozeForTask cancels pending reminders and schedules one at the new time', async () => {
    const create = jest.fn().mockResolvedValue({});
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      reminder: {
        findFirst: jest.fn().mockResolvedValue({ channels: ['IN_APP', 'PUSH'] }),
        updateMany,
        create,
      },
    } as unknown as PrismaService;
    const service = new ReminderService(prisma);

    const remindAt = new Date('2026-07-11T09:00:00.000Z');
    await service.snoozeForTask(taskRow(), remindAt);

    expect(updateMany).toHaveBeenCalledWith({
      where: { organizationId: 'org1', taskId: 'task1', status: 'SCHEDULED' },
      data: { status: 'CANCELLED' },
    });
    expect(create).toHaveBeenCalledWith({
      data: { organizationId: 'org1', taskId: 'task1', remindAt, channels: ['IN_APP', 'PUSH'] },
    });
  });
});
