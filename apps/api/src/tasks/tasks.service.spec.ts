import { bucketWhere, TasksService } from './tasks.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ReminderService } from './reminder.service';
import type { ActivityService } from '../activity/activity.service';
import type { UsersService } from '../users/users.service';
import type { NotificationService } from '../notifications/notification.service';

describe('bucketWhere (agenda buckets in the assignee timezone)', () => {
  const now = new Date('2026-07-10T16:00:00.000Z'); // 12:00 in New York

  it('overdue = anchor strictly before now', () => {
    expect(bucketWhere('overdue', now, 'America/New_York')).toEqual({
      OR: [{ dueAt: { lt: now } }, { startAt: { lt: now } }],
    });
  });

  it('today = anchor from now until the end of the local day', () => {
    const where = bucketWhere('today', now, 'America/New_York');
    // End of the NY local day (2026-07-11 00:00 EDT) = 2026-07-11T04:00Z.
    expect(where).toEqual({
      OR: [
        { dueAt: { gte: now, lt: new Date('2026-07-11T04:00:00.000Z') } },
        { startAt: { gte: now, lt: new Date('2026-07-11T04:00:00.000Z') } },
      ],
    });
  });

  it('upcoming = anchor at or after the next local midnight', () => {
    expect(bucketWhere('upcoming', now, 'America/New_York')).toEqual({
      OR: [
        { dueAt: { gte: new Date('2026-07-11T04:00:00.000Z') } },
        { startAt: { gte: new Date('2026-07-11T04:00:00.000Z') } },
      ],
    });
  });
});

// ---------------------------------------------------------------------------

function makeService(overrides: {
  prisma?: Partial<PrismaService>;
  reminders?: Partial<ReminderService>;
  activity?: Partial<ActivityService>;
  notifications?: Partial<NotificationService>;
} = {}) {
  const taskRow = {
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
    relatedType: 'CONTACT',
    relatedId: 'c1',
    completedAt: null,
    outcome: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    reminders: [],
  };

  const prisma = {
    task: {
      findFirst: jest.fn().mockResolvedValue(taskRow),
      // Echo the written data so assignee/status changes are reflected downstream.
      create: jest.fn().mockImplementation(({ data }) => ({ ...taskRow, ...data })),
      update: jest.fn().mockImplementation(({ data }) => ({ ...taskRow, ...data })),
    },
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'u1' }), findMany: jest.fn().mockResolvedValue([]) },
    contact: {
      findFirst: jest.fn().mockResolvedValue({ id: 'c1' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    ...overrides.prisma,
  } as unknown as PrismaService;

  const reminders = {
    syncForTask: jest.fn().mockResolvedValue(undefined),
    cancelForTask: jest.fn().mockResolvedValue(undefined),
    shiftForTask: jest.fn().mockResolvedValue(undefined),
    snoozeForTask: jest.fn().mockResolvedValue(undefined),
    ...overrides.reminders,
  } as unknown as ReminderService;

  const activity = { emit: jest.fn().mockResolvedValue(undefined), ...overrides.activity } as unknown as ActivityService;
  const users = { timezoneFor: jest.fn().mockResolvedValue('UTC') } as unknown as UsersService;
  const notifications = {
    fanOut: jest.fn().mockResolvedValue({}),
    ...overrides.notifications,
  } as unknown as NotificationService;

  return { service: new TasksService(prisma, reminders, activity, users, notifications), prisma, reminders, activity, notifications, taskRow };
}

describe('TasksService', () => {
  it('create schedules reminders, emits TASK_CREATED on the related timeline, and notifies a different assignee', async () => {
    const { service, reminders, activity, notifications } = makeService();

    await service.create(
      'org1',
      {
        type: 'FOLLOW_UP',
        title: 'Follow up',
        priority: 'MEDIUM',
        relatedType: 'CONTACT',
        relatedId: 'c1',
        assigneeId: 'u2',
        reminders: [{ minutesBefore: 60 }],
      } as never,
      'u1',
    );

    expect(reminders.syncForTask).toHaveBeenCalledWith(
      expect.anything(),
      [{ minutesBefore: 60 }],
    );
    expect(activity.emit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'TASK_CREATED', entityType: 'CONTACT', entityId: 'c1' }),
    );
    // assignee (u2) ≠ creator (u1) → an ASSIGNMENT notification.
    expect(notifications.fanOut).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ASSIGNMENT', userId: 'u2' }),
    );
  });

  it('complete cancels pending reminders and emits TASK_COMPLETED', async () => {
    const { service, reminders, activity } = makeService();

    await service.complete('org1', 'task1', { outcome: 'Sent proposal' }, 'u1');

    expect(reminders.cancelForTask).toHaveBeenCalledWith('org1', 'task1');
    expect(activity.emit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'TASK_COMPLETED', entityType: 'CONTACT', entityId: 'c1' }),
    );
  });

  it('reassign redirects (leaves reminders in place) and notifies the new assignee', async () => {
    const { service, reminders, notifications } = makeService();

    await service.reassign('org1', 'task1', { assigneeId: 'u2' }, 'u1');

    // Pending reminders are NOT re-created/cancelled — the send worker resolves
    // the current assignee, so redirection is automatic.
    expect(reminders.cancelForTask).not.toHaveBeenCalled();
    expect(reminders.syncForTask).not.toHaveBeenCalled();
    expect(notifications.fanOut).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ASSIGNMENT', userId: 'u2' }),
    );
  });
});
