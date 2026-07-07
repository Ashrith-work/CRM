import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { ReminderService } from './reminder.service';
import { ReminderSweepProcessor } from './reminder-sweep.processor';
import { ReminderSendProcessor } from './reminder-send.processor';
import { REMINDER_SEND_QUEUE, REMINDER_SWEEP_QUEUE } from './reminder.constants';

/**
 * Tasks + the BullMQ reminder engine. Registers the sweep + send queues and
 * their processors; depends on NotificationsModule for the send fan-out and
 * UsersModule for the assignee's timezone.
 */
@Module({
  imports: [
    UsersModule,
    NotificationsModule,
    BullModule.registerQueue({ name: REMINDER_SWEEP_QUEUE }, { name: REMINDER_SEND_QUEUE }),
  ],
  controllers: [TasksController],
  providers: [TasksService, ReminderService, ReminderSweepProcessor, ReminderSendProcessor],
  exports: [TasksService, ReminderService],
})
export class TasksModule {}
