import { Injectable } from '@nestjs/common';
import { DEFAULT_REMINDER_CHANNELS, type ReminderChannel, type ReminderOffsetInput } from '@crm/types';
import type { Reminder as ReminderRow, Task as TaskRow } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** The scheduling anchor for a task's reminders: the meeting start, else the due date. */
export function taskAnchor(task: Pick<TaskRow, 'startAt' | 'dueAt'>): Date | null {
  return task.startAt ?? task.dueAt ?? null;
}

/**
 * Reminder scheduling. Reminders are plain DB rows (status SCHEDULED) — the
 * 60s BullMQ sweep polls them, so scheduling is inherently restart-safe (no
 * in-memory timers). (Re)creating a task's reminders means: cancel the pending
 * ones and insert fresh SCHEDULED rows computed from the anchor + offsets.
 */
@Injectable()
export class ReminderService {
  constructor(private readonly prisma: PrismaService) {}

  /** Replace a task's SCHEDULED reminders with ones derived from `offsets`
   * (minutes before the anchor). SENT/CANCELLED rows are left as history. */
  async syncForTask(task: TaskRow, offsets: ReminderOffsetInput[]): Promise<void> {
    await this.cancelForTask(task.organizationId, task.id);

    const anchor = taskAnchor(task);
    if (!anchor || offsets.length === 0) return;

    await this.prisma.reminder.createMany({
      data: offsets.map((o) => ({
        organizationId: task.organizationId,
        taskId: task.id,
        remindAt: new Date(anchor.getTime() - o.minutesBefore * 60_000),
        channels: (o.channels ?? DEFAULT_REMINDER_CHANNELS) as string[],
      })),
    });
  }

  /** Cancel all pending reminders for a task (on complete/cancel/delete). */
  async cancelForTask(organizationId: string, taskId: string): Promise<void> {
    await this.prisma.reminder.updateMany({
      where: { organizationId, taskId, status: 'SCHEDULED' },
      data: { status: 'CANCELLED' },
    });
  }

  /** Shift a task's pending reminders by (newAnchor − oldAnchor), preserving
   * each reminder's "N minutes before" offset. Used on reschedule. */
  async shiftForTask(
    organizationId: string,
    taskId: string,
    oldAnchor: Date | null,
    newAnchor: Date | null,
  ): Promise<void> {
    const pending = await this.prisma.reminder.findMany({
      where: { organizationId, taskId, status: 'SCHEDULED' },
    });
    if (pending.length === 0) return;

    // No new anchor → nothing to fire against; cancel them.
    if (!newAnchor) {
      await this.cancelForTask(organizationId, taskId);
      return;
    }
    // No old anchor → can't preserve an offset; leave rows as-is.
    if (!oldAnchor) return;

    const delta = newAnchor.getTime() - oldAnchor.getTime();
    await this.prisma.$transaction(
      pending.map((r) =>
        this.prisma.reminder.update({
          where: { id: r.id },
          data: { remindAt: new Date(r.remindAt.getTime() + delta) },
        }),
      ),
    );
  }

  /** Snooze: cancel pending reminders and schedule a single one at `remindAt`,
   * reusing the channels of the most recent reminder (or the defaults). */
  async snoozeForTask(task: TaskRow, remindAt: Date): Promise<void> {
    const latest = await this.prisma.reminder.findFirst({
      where: { organizationId: task.organizationId, taskId: task.id },
      orderBy: { createdAt: 'desc' },
    });
    const channels = (latest?.channels?.length ? latest.channels : DEFAULT_REMINDER_CHANNELS) as string[];
    await this.cancelForTask(task.organizationId, task.id);
    await this.prisma.reminder.create({
      data: { organizationId: task.organizationId, taskId: task.id, remindAt, channels },
    });
  }
}

export function serializeReminder(row: ReminderRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    taskId: row.taskId,
    remindAt: row.remindAt.toISOString(),
    channels: row.channels as ReminderChannel[],
    status: row.status,
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
