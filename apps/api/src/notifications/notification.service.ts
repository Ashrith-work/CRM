import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  EntityType,
  Notification as NotificationDto,
  NotificationChannel,
  NotificationListQueryInput,
  NotificationListResponse,
  NotificationType,
} from '@crm/types';
import type { Notification as NotificationRow } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toPage } from '../common/list.util';
import { PushTokensService } from '../push-tokens/push-tokens.service';
import { EmailProvider } from './email.provider';
import { PushProvider } from './push.provider';
import { NotificationsGateway } from './notifications.gateway';

export interface FanOutInput {
  organizationId: string;
  /** Recipient User.id. */
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  relatedType?: EntityType | null;
  relatedId?: string | null;
  taskId?: string | null;
  /** Channels to attempt. Defaults to IN_APP only. */
  channels?: NotificationChannel[];
}

/**
 * The single notification fan-out. Creates the durable Notification row (the
 * in-app record — always persisted so an offline user sees it on next load),
 * then delivers each requested channel EXACTLY ONCE behind one API:
 *   IN_APP → Socket.io room emit    EMAIL → provider    PUSH → Expo.
 * deliveredChannels records which channels succeeded.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailProvider,
    private readonly push: PushProvider,
    private readonly pushTokens: PushTokensService,
    private readonly gateway: NotificationsGateway,
  ) {}

  async fanOut(input: FanOutInput): Promise<NotificationDto> {
    const requested = input.channels?.length ? [...new Set(input.channels)] : ['IN_APP'];
    const delivered: NotificationChannel[] = [];

    // 1. Durable in-app record first — this is the IN_APP delivery.
    const row = await this.prisma.notification.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        relatedType: input.relatedType ?? null,
        relatedId: input.relatedId ?? null,
        taskId: input.taskId ?? null,
        deliveredChannels: [],
      },
    });
    if (requested.includes('IN_APP')) delivered.push('IN_APP');

    // 2. Email (best-effort; never blocks the other channels).
    if (requested.includes('EMAIL')) {
      try {
        const user = await this.prisma.user.findFirst({
          where: { id: input.userId, organizationId: input.organizationId },
          select: { email: true },
        });
        if (user?.email) {
          await this.email.send({ to: user.email, subject: input.title, text: input.body });
          delivered.push('EMAIL');
        }
      } catch (err) {
        this.logger.warn(`Email channel failed for notification ${row.id}: ${(err as Error).message}`);
      }
    }

    // 3. Push (best-effort; prune tokens Expo rejects).
    if (requested.includes('PUSH')) {
      try {
        const tokens = await this.pushTokens.tokensForUser(input.organizationId, input.userId);
        if (tokens.length) {
          const { invalidTokens } = await this.push.send(
            tokens.map((t) => t.token),
            {
              title: input.title,
              body: input.body,
              data: { notificationId: row.id, taskId: input.taskId ?? null, type: input.type },
            },
          );
          await this.pushTokens.prune(invalidTokens);
          delivered.push('PUSH');
        }
      } catch (err) {
        this.logger.warn(`Push channel failed for notification ${row.id}: ${(err as Error).message}`);
      }
    }

    const saved = await this.prisma.notification.update({
      where: { id: row.id },
      data: { deliveredChannels: delivered },
    });
    const dto = serializeNotification(saved);

    // 4. Live in-app: push the row + the new unread count to any open sockets.
    this.gateway.emitNotification(input.organizationId, input.userId, dto);
    await this.pushUnreadCount(input.organizationId, input.userId);

    return dto;
  }

  async list(
    organizationId: string,
    userId: string,
    query: NotificationListQueryInput,
  ): Promise<NotificationListResponse> {
    const where = {
      organizationId,
      userId,
      deletedAt: null,
      ...(query.unread ? { readAt: null } : {}),
    };
    const rows = await this.prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = toPage(rows, query.limit);
    const unreadCount = await this.unreadCount(organizationId, userId);
    return {
      data: page.data.map(serializeNotification),
      nextCursor: page.nextCursor,
      unreadCount,
    };
  }

  async unreadCount(organizationId: string, userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { organizationId, userId, readAt: null, deletedAt: null },
    });
  }

  async markRead(organizationId: string, userId: string, id: string): Promise<NotificationDto> {
    const existing = await this.prisma.notification.findFirst({
      where: { id, organizationId, userId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Notification not found');
    const row = existing.readAt
      ? existing
      : await this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
    await this.pushUnreadCount(organizationId, userId);
    return serializeNotification(row);
  }

  async markAllRead(organizationId: string, userId: string): Promise<number> {
    const { count } = await this.prisma.notification.updateMany({
      where: { organizationId, userId, readAt: null, deletedAt: null },
      data: { readAt: new Date() },
    });
    await this.pushUnreadCount(organizationId, userId);
    return count;
  }

  private async pushUnreadCount(organizationId: string, userId: string): Promise<void> {
    const count = await this.unreadCount(organizationId, userId);
    this.gateway.emitUnreadCount(organizationId, userId, count);
  }
}

export function serializeNotification(row: NotificationRow): NotificationDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    type: row.type,
    title: row.title,
    body: row.body,
    relatedType: row.relatedType,
    relatedId: row.relatedId,
    taskId: row.taskId,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    deliveredChannels: row.deliveredChannels as NotificationChannel[],
    createdAt: row.createdAt.toISOString(),
  };
}
