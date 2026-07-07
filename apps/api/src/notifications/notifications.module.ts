import { Module } from '@nestjs/common';
import { PushTokensModule } from '../push-tokens/push-tokens.module';
import { NotificationService } from './notification.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { EmailProvider } from './email.provider';
import { PushProvider } from './push.provider';

/**
 * Notification fan-out (in-app via Socket.io / email / push) behind a single
 * NotificationService, exported for the reminder send worker (and any future
 * ASSIGNMENT/MENTION producers).
 */
@Module({
  imports: [PushTokensModule],
  controllers: [NotificationsController],
  providers: [NotificationService, NotificationsGateway, EmailProvider, PushProvider],
  exports: [NotificationService],
})
export class NotificationsModule {}
