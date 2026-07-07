import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import type { Env } from '../config/env';
import {
  REMINDER_SEND_QUEUE,
  REMINDER_SWEEP_QUEUE,
  SWEEP_BATCH,
  SWEEP_JOB_ID,
  type ReminderSendJob,
} from './reminder.constants';

/**
 * The reminder sweep. A repeatable job (every REMINDER_SWEEP_INTERVAL_MS)
 * selects reminders that are due & still SCHEDULED, claims each one atomically
 * (SCHEDULED → SENT in a single guarded UPDATE), and enqueues a send job keyed
 * by the reminder id.
 *
 * Restart-safe: a reminder that came due while the worker was down is simply
 * still SCHEDULED with a past remindAt, so the next tick picks it up. The atomic
 * claim + per-reminder jobId guarantee each reminder fires exactly once.
 */
@Processor(REMINDER_SWEEP_QUEUE)
export class ReminderSweepProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ReminderSweepProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @InjectQueue(REMINDER_SWEEP_QUEUE) private readonly sweepQueue: Queue,
    @InjectQueue(REMINDER_SEND_QUEUE) private readonly sendQueue: Queue,
  ) {
    super();
  }

  /** Register (or refresh) the single repeatable sweep job on boot. */
  async onModuleInit(): Promise<void> {
    const every = this.config.get('REMINDER_SWEEP_INTERVAL_MS', { infer: true });
    await this.sweepQueue.add(
      'sweep',
      {},
      { repeat: { every }, jobId: SWEEP_JOB_ID, removeOnComplete: true, removeOnFail: 50 },
    );
    this.logger.log(`Reminder sweep scheduled every ${every}ms`);
  }

  async process(): Promise<{ claimed: number }> {
    const now = new Date();
    const due = await this.prisma.reminder.findMany({
      where: { status: 'SCHEDULED', remindAt: { lte: now }, deletedAt: null },
      orderBy: { remindAt: 'asc' },
      take: SWEEP_BATCH,
      select: { id: true },
    });
    if (due.length === 0) return { claimed: 0 };

    let claimed = 0;
    for (const { id } of due) {
      // Atomic claim: only the tick that flips SCHEDULED → SENT enqueues a send.
      const { count } = await this.prisma.reminder.updateMany({
        where: { id, status: 'SCHEDULED' },
        data: { status: 'SENT', sentAt: now },
      });
      if (count !== 1) continue; // already claimed by another tick

      await this.sendQueue.add(
        'send',
        { reminderId: id } satisfies ReminderSendJob,
        { jobId: `send_${id}`, removeOnComplete: true, removeOnFail: 200, attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
      );
      claimed += 1;
    }

    if (claimed > 0) this.logger.log(`Swept ${claimed} due reminder(s)`);
    return { claimed };
  }
}
