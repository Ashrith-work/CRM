import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AgendaResponse,
  CompleteTaskInput,
  CreateTaskInput,
  ReassignTaskInput,
  RelatedRef,
  RescheduleTaskInput,
  SnoozeTaskInput,
  Task as TaskDto,
  TaskListQueryInput,
  UpdateTaskInput,
} from '@crm/types';
import {
  Prisma,
  type ActivityEventType,
  type EntityType,
  type Task as TaskRow,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { UsersService } from '../users/users.service';
import { NotificationService } from '../notifications/notification.service';
import { resolveActors } from '../common/actors.util';
import { resolveOrderBy } from '../common/list.util';
import { startOfNextLocalDayUtc } from '../common/timezone.util';
import { ReminderService, serializeReminder, taskAnchor } from './reminder.service';

const SORTABLE = ['dueAt', 'startAt', 'priority', 'title', 'createdAt', 'updatedAt'] as const;
const TASK_INCLUDE = { reminders: { orderBy: { remindAt: 'asc' as const } } } satisfies Prisma.TaskInclude;
type TaskWithReminders = Prisma.TaskGetPayload<{ include: typeof TASK_INCLUDE }>;

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reminders: ReminderService,
    private readonly activity: ActivityService,
    private readonly users: UsersService,
    private readonly notifications: NotificationService,
  ) {}

  // ----- Reads -------------------------------------------------------------
  async list(
    organizationId: string,
    currentUserId: string,
    query: TaskListQueryInput,
  ): Promise<{ data: TaskDto[]; nextCursor: string | null }> {
    const where: Prisma.TaskWhereInput = { organizationId, deletedAt: null };
    if (query.type) where.type = query.type;
    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.assigneeId) where.assigneeId = query.assigneeId === 'me' ? currentUserId : query.assigneeId;
    if (query.relatedType) where.relatedType = query.relatedType;
    if (query.relatedId) where.relatedId = query.relatedId;
    if (query.search) where.title = { contains: query.search, mode: 'insensitive' };

    // Calendar window (absolute UTC) — match tasks whose anchor is in [from,to].
    if (query.from || query.to) {
      const range: Prisma.DateTimeFilter = {};
      if (query.from) range.gte = new Date(query.from);
      if (query.to) range.lte = new Date(query.to);
      where.OR = [{ dueAt: range }, { startAt: range }];
    }

    // Agenda buckets, resolved in the assignee's local day.
    if (query.bucket && query.bucket !== 'all') {
      const tzUserId = where.assigneeId && typeof where.assigneeId === 'string' ? where.assigneeId : currentUserId;
      const tz = await this.users.timezoneFor(organizationId, tzUserId);
      Object.assign(where, bucketWhere(query.bucket, new Date(), tz));
    }

    const rows = await this.prisma.task.findMany({
      where,
      include: TASK_INCLUDE,
      orderBy: resolveOrderBy(query.sort, query.order, SORTABLE, 'dueAt'),
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > query.limit;
    const data = hasMore ? rows.slice(0, query.limit) : rows;
    const last = data[data.length - 1];
    return {
      data: await this.serializeMany(organizationId, data),
      nextCursor: hasMore && last ? last.id : null,
    };
  }

  async get(organizationId: string, id: string): Promise<TaskDto> {
    const task = await this.prisma.task.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: TASK_INCLUDE,
    });
    if (!task) throw new NotFoundException('Task not found');
    return (await this.serializeMany(organizationId, [task]))[0];
  }

  /** Agenda for a user: overdue / today / upcoming, bucketed in their timezone. */
  async agenda(
    organizationId: string,
    currentUserId: string,
    assigneeId?: string,
    type?: TaskDto['type'],
  ): Promise<AgendaResponse> {
    const userId = !assigneeId || assigneeId === 'me' ? currentUserId : assigneeId;
    const tz = await this.users.timezoneFor(organizationId, userId);
    const now = new Date();

    const base: Prisma.TaskWhereInput = {
      organizationId,
      deletedAt: null,
      status: 'OPEN',
      assigneeId: userId,
      ...(type ? { type } : {}),
    };

    const [overdue, today, upcoming] = await Promise.all([
      this.prisma.task.findMany({
        where: { ...base, ...bucketWhere('overdue', now, tz) },
        include: TASK_INCLUDE,
        orderBy: [{ dueAt: 'asc' }, { startAt: 'asc' }],
      }),
      this.prisma.task.findMany({
        where: { ...base, ...bucketWhere('today', now, tz) },
        include: TASK_INCLUDE,
        orderBy: [{ dueAt: 'asc' }, { startAt: 'asc' }],
      }),
      this.prisma.task.findMany({
        where: { ...base, ...bucketWhere('upcoming', now, tz) },
        include: TASK_INCLUDE,
        orderBy: [{ dueAt: 'asc' }, { startAt: 'asc' }],
        take: 100,
      }),
    ]);

    return {
      timezone: tz,
      overdue: await this.serializeMany(organizationId, overdue),
      today: await this.serializeMany(organizationId, today),
      upcoming: await this.serializeMany(organizationId, upcoming),
    };
  }

  // ----- Writes ------------------------------------------------------------
  async create(
    organizationId: string,
    input: CreateTaskInput,
    actorId: string,
    source = 'api',
  ): Promise<TaskDto> {
    const assigneeId = input.assigneeId ?? actorId;
    await this.assertAssignee(organizationId, assigneeId);
    await this.assertRelated(organizationId, input.relatedType ?? null, input.relatedId ?? null);

    const task = await this.prisma.task.create({
      data: {
        organizationId,
        type: input.type,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        startAt: input.startAt ? new Date(input.startAt) : null,
        endAt: input.endAt ? new Date(input.endAt) : null,
        location: input.location ?? null,
        meetingUrl: input.meetingUrl ?? null,
        assigneeId,
        createdById: actorId,
        relatedType: (input.relatedType ?? null) as EntityType | null,
        relatedId: input.relatedId ?? null,
      },
    });

    await this.reminders.syncForTask(task, input.reminders ?? []);
    await this.emitTaskActivity(task, 'TASK_CREATED', actorId, source);
    if (assigneeId !== actorId) await this.notifyAssignment(task, actorId);

    return this.get(organizationId, task.id);
  }

  async update(
    organizationId: string,
    id: string,
    input: UpdateTaskInput,
    actorId: string,
    source = 'api',
  ): Promise<TaskDto> {
    const current = await this.requireTask(organizationId, id);
    if (input.relatedType !== undefined || input.relatedId !== undefined) {
      await this.assertRelated(
        organizationId,
        (input.relatedType === undefined ? current.relatedType : input.relatedType) ?? null,
        (input.relatedId === undefined ? current.relatedId : input.relatedId) ?? null,
      );
    }

    const anchorChanged =
      input.dueAt !== undefined || input.startAt !== undefined;

    const updated = await this.prisma.task.update({
      where: { id },
      data: {
        type: input.type,
        title: input.title,
        ...(input.description !== undefined ? { description: input.description } : {}),
        priority: input.priority,
        ...(input.dueAt !== undefined ? { dueAt: input.dueAt ? new Date(input.dueAt) : null } : {}),
        ...(input.startAt !== undefined ? { startAt: input.startAt ? new Date(input.startAt) : null } : {}),
        ...(input.endAt !== undefined ? { endAt: input.endAt ? new Date(input.endAt) : null } : {}),
        ...(input.location !== undefined ? { location: input.location } : {}),
        ...(input.meetingUrl !== undefined ? { meetingUrl: input.meetingUrl } : {}),
        ...(input.relatedType !== undefined ? { relatedType: (input.relatedType ?? null) as EntityType | null } : {}),
        ...(input.relatedId !== undefined ? { relatedId: input.relatedId ?? null } : {}),
      },
    });

    // Reminders: explicit list replaces them; otherwise a moved anchor shifts them.
    if (input.reminders !== undefined) {
      await this.reminders.syncForTask(updated, input.reminders);
    } else if (anchorChanged) {
      await this.reminders.shiftForTask(organizationId, id, taskAnchor(current), taskAnchor(updated));
    }

    await this.emitTaskActivity(updated, 'TASK_UPDATED', actorId, source);
    return this.get(organizationId, id);
  }

  async complete(
    organizationId: string,
    id: string,
    input: CompleteTaskInput,
    actorId: string,
    source = 'api',
  ): Promise<TaskDto> {
    const task = await this.requireTask(organizationId, id);
    if (task.status === 'DONE') return this.get(organizationId, id);

    const updated = await this.prisma.task.update({
      where: { id },
      data: { status: 'DONE', completedAt: new Date(), outcome: input.outcome ?? task.outcome },
    });
    await this.reminders.cancelForTask(organizationId, id);
    await this.emitTaskActivity(updated, 'TASK_COMPLETED', actorId, source, {
      outcome: input.outcome ?? null,
    });
    return this.get(organizationId, id);
  }

  async cancel(organizationId: string, id: string, actorId: string, source = 'api'): Promise<TaskDto> {
    const task = await this.requireTask(organizationId, id);
    if (task.status === 'CANCELLED') return this.get(organizationId, id);
    const updated = await this.prisma.task.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.reminders.cancelForTask(organizationId, id);
    await this.emitTaskActivity(updated, 'TASK_CANCELLED', actorId, source);
    return this.get(organizationId, id);
  }

  async reschedule(
    organizationId: string,
    id: string,
    input: RescheduleTaskInput,
    actorId: string,
    source = 'api',
  ): Promise<TaskDto> {
    const current = await this.requireTask(organizationId, id);
    const updated = await this.prisma.task.update({
      where: { id },
      data: {
        ...(input.dueAt !== undefined ? { dueAt: input.dueAt ? new Date(input.dueAt) : null } : {}),
        ...(input.startAt !== undefined ? { startAt: input.startAt ? new Date(input.startAt) : null } : {}),
        ...(input.endAt !== undefined ? { endAt: input.endAt ? new Date(input.endAt) : null } : {}),
      },
    });
    await this.reminders.shiftForTask(organizationId, id, taskAnchor(current), taskAnchor(updated));
    await this.emitTaskActivity(updated, 'TASK_UPDATED', actorId, source);
    return this.get(organizationId, id);
  }

  async snooze(
    organizationId: string,
    id: string,
    input: SnoozeTaskInput,
    actorId: string,
    source = 'api',
  ): Promise<TaskDto> {
    const task = await this.requireTask(organizationId, id);
    if (task.status !== 'OPEN') throw new BadRequestException('Only open tasks can be snoozed');
    await this.reminders.snoozeForTask(task, new Date(input.remindAt));
    await this.emitTaskActivity(task, 'TASK_UPDATED', actorId, source, { snoozedTo: input.remindAt });
    return this.get(organizationId, id);
  }

  async reassign(
    organizationId: string,
    id: string,
    input: ReassignTaskInput,
    actorId: string,
    source = 'api',
  ): Promise<TaskDto> {
    const task = await this.requireTask(organizationId, id);
    await this.assertAssignee(organizationId, input.assigneeId);
    if (task.assigneeId === input.assigneeId) return this.get(organizationId, id);

    const updated = await this.prisma.task.update({
      where: { id },
      data: { assigneeId: input.assigneeId },
    });
    // Reminders reference the task; the send worker resolves the CURRENT
    // assignee at fire time, so pending reminders redirect automatically.
    await this.emitTaskActivity(updated, 'TASK_UPDATED', actorId, source, { reassignedTo: input.assigneeId });
    if (input.assigneeId !== actorId) await this.notifyAssignment(updated, actorId);
    return this.get(organizationId, id);
  }

  async remove(organizationId: string, id: string): Promise<void> {
    await this.requireTask(organizationId, id);
    await this.prisma.task.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.reminders.cancelForTask(organizationId, id);
  }

  // ----- Helpers -----------------------------------------------------------
  private async notifyAssignment(task: TaskRow, actorId: string): Promise<void> {
    await this.notifications.fanOut({
      organizationId: task.organizationId,
      userId: task.assigneeId,
      type: 'ASSIGNMENT',
      title: `You were assigned: ${task.title}`,
      body: task.dueAt ? `Due ${task.dueAt.toISOString()}` : 'A task was assigned to you.',
      relatedType: task.relatedType,
      relatedId: task.relatedId,
      taskId: task.id,
      channels: ['IN_APP', 'PUSH'],
    });
    void actorId;
  }

  private async emitTaskActivity(
    task: TaskRow,
    eventType: ActivityEventType,
    actorId: string,
    source: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    // Tasks live on the RELATED entity's timeline (CONTACT/COMPANY/LEAD/DEAL).
    if (!task.relatedType || !task.relatedId) return;
    const metadata = {
      taskId: task.id,
      taskType: task.type,
      title: task.title,
      ...extra,
    } as Prisma.InputJsonValue;
    await this.activity.emit({
      organizationId: task.organizationId,
      entityType: task.relatedType,
      entityId: task.relatedId,
      eventType,
      actorId,
      metadata,
      source,
    });
  }

  private async assertAssignee(organizationId: string, userId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, organizationId }, select: { id: true } });
    if (!user) throw new BadRequestException('assigneeId does not reference a user in this org');
  }

  private async assertRelated(
    organizationId: string,
    relatedType: EntityType | null,
    relatedId: string | null,
  ): Promise<void> {
    if (!relatedType || !relatedId) return;
    const exists = await this.relatedExists(organizationId, relatedType, relatedId);
    if (!exists) throw new BadRequestException('related record not found in this org');
  }

  private async relatedExists(organizationId: string, type: EntityType, id: string): Promise<boolean> {
    const where = { id, organizationId, deletedAt: null };
    switch (type) {
      case 'CONTACT':
        return !!(await this.prisma.contact.findFirst({ where, select: { id: true } }));
      case 'COMPANY':
        return !!(await this.prisma.company.findFirst({ where, select: { id: true } }));
      case 'LEAD':
        return !!(await this.prisma.lead.findFirst({ where, select: { id: true } }));
      case 'DEAL':
        return !!(await this.prisma.deal.findFirst({ where, select: { id: true } }));
      default:
        return false;
    }
  }

  private async requireTask(organizationId: string, id: string): Promise<TaskRow> {
    const task = await this.prisma.task.findFirst({ where: { id, organizationId, deletedAt: null } });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  private async serializeMany(
    organizationId: string,
    tasks: TaskWithReminders[],
  ): Promise<TaskDto[]> {
    const actors = await resolveActors(
      this.prisma,
      organizationId,
      tasks.flatMap((t) => [t.assigneeId, t.createdById]),
    );
    const relatedMap = await this.resolveRelated(organizationId, tasks);
    return tasks.map((t) => serializeTask(t, actors, relatedMap));
  }

  /** Batch-resolve related-entity display labels for a set of tasks. */
  private async resolveRelated(
    organizationId: string,
    tasks: Array<Pick<TaskRow, 'relatedType' | 'relatedId'>>,
  ): Promise<Map<string, RelatedRef>> {
    const byType: Record<EntityType, Set<string>> = {
      CONTACT: new Set(),
      COMPANY: new Set(),
      LEAD: new Set(),
      DEAL: new Set(),
    };
    for (const t of tasks) {
      if (t.relatedType && t.relatedId) byType[t.relatedType].add(t.relatedId);
    }
    const map = new Map<string, RelatedRef>();
    const add = (type: EntityType, id: string, label: string) => map.set(`${type}:${id}`, { type, id, label });

    if (byType.CONTACT.size) {
      const rows = await this.prisma.contact.findMany({
        where: { organizationId, id: { in: [...byType.CONTACT] } },
        select: { id: true, firstName: true, lastName: true },
      });
      rows.forEach((r) => add('CONTACT', r.id, `${r.firstName} ${r.lastName}`.trim()));
    }
    if (byType.COMPANY.size) {
      const rows = await this.prisma.company.findMany({
        where: { organizationId, id: { in: [...byType.COMPANY] } },
        select: { id: true, name: true },
      });
      rows.forEach((r) => add('COMPANY', r.id, r.name));
    }
    if (byType.LEAD.size) {
      const rows = await this.prisma.lead.findMany({
        where: { organizationId, id: { in: [...byType.LEAD] } },
        select: { id: true, firstName: true, lastName: true },
      });
      rows.forEach((r) => add('LEAD', r.id, `${r.firstName} ${r.lastName}`.trim()));
    }
    if (byType.DEAL.size) {
      const rows = await this.prisma.deal.findMany({
        where: { organizationId, id: { in: [...byType.DEAL] } },
        select: { id: true, name: true },
      });
      rows.forEach((r) => add('DEAL', r.id, r.name));
    }
    return map;
  }
}

/** Prisma where-fragment for an agenda bucket, computed against `tz`'s local day. */
export function bucketWhere(
  bucket: 'overdue' | 'today' | 'upcoming',
  now: Date,
  tz: string,
): Prisma.TaskWhereInput {
  const startTomorrow = startOfNextLocalDayUtc(now, tz);
  const anchorIn = (range: Prisma.DateTimeFilter): Prisma.TaskWhereInput => ({
    OR: [{ dueAt: range }, { startAt: range }],
  });
  switch (bucket) {
    case 'overdue':
      return anchorIn({ lt: now });
    case 'today':
      // From now until the end of the assignee's local day.
      return anchorIn({ gte: now, lt: startTomorrow });
    case 'upcoming':
      return anchorIn({ gte: startTomorrow });
  }
}

export function serializeTask(
  task: TaskWithReminders,
  actors: Map<string, { id: string; firstName: string | null; lastName: string | null; email: string }>,
  related: Map<string, RelatedRef>,
): TaskDto {
  return {
    id: task.id,
    organizationId: task.organizationId,
    type: task.type,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueAt: task.dueAt ? task.dueAt.toISOString() : null,
    startAt: task.startAt ? task.startAt.toISOString() : null,
    endAt: task.endAt ? task.endAt.toISOString() : null,
    location: task.location,
    meetingUrl: task.meetingUrl,
    assigneeId: task.assigneeId,
    assignee: actors.get(task.assigneeId) ?? null,
    createdById: task.createdById,
    createdBy: actors.get(task.createdById) ?? null,
    relatedType: task.relatedType,
    relatedId: task.relatedId,
    related: task.relatedType && task.relatedId ? related.get(`${task.relatedType}:${task.relatedId}`) ?? null : null,
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
    outcome: task.outcome,
    reminders: task.reminders.map(serializeReminder),
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}
