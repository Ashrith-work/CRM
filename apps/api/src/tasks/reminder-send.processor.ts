import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type { ReminderChannel } from '@crm/types';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { REMINDER_SEND_QUEUE, SEND_CONCURRENCY, type ReminderSendJob } from './reminder.constants';

/**
 * Delivers a single reminder by fanning out a REMINDER notification. Concurrency
 * is capped (SEND_CONCURRENCY) so a storm of simultaneous reminders is throttled.
 *
 * The recipient is resolved from the task's CURRENT assignee at send time, so a
 * reassigned task's pending reminder reaches the new owner. Reminders for a
 * DONE/CANCELLED/deleted task are skipped.
 */
@Processor(REMINDER_SEND_QUEUE, { concurrency: SEND_CONCURRENCY })
export class ReminderSendProcessor extends WorkerHost {
  private readonly logger = new Logger(ReminderSendProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {
    super();
  }

  async process(job: Job<ReminderSendJob>): Promise<{ delivered: boolean }> {
    const reminder = await this.prisma.reminder.findUnique({
      where: { id: job.data.reminderId },
      include: { task: true },
    });
    if (!reminder || !reminder.task) return { delivered: false };

    const task = reminder.task;
    if (task.deletedAt || task.status !== 'OPEN') {
      this.logger.debug(`Skipping reminder ${reminder.id}: task ${task.status}`);
      return { delivered: false };
    }

    await this.notifications.fanOut({
      organizationId: task.organizationId,
      userId: task.assigneeId,
      type: 'REMINDER',
      title: `Reminder: ${task.title}`,
      body: reminderBody(task.dueAt, task.startAt),
      relatedType: task.relatedType,
      relatedId: task.relatedId,
      taskId: task.id,
      channels: reminder.channels as ReminderChannel[],
    });
    return { delivered: true };
  }
}

function reminderBody(dueAt: Date | null, startAt: Date | null): string {
  const at = startAt ?? dueAt;
  return at ? `Scheduled for ${at.toISOString()}` : 'You have a task reminder.';
}
