import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  NotificationListQueryInput,
  PERMISSIONS,
  type Notification,
  type NotificationListResponse,
  type UnreadCountResponse,
} from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { NotificationService } from './notification.service';

/**
 * Per-user notification center. Every route is scoped to the current user, so
 * USER_READ (held by every role) is sufficient — a user only ever sees/mutates
 * their own notifications.
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  @RequirePermission(PERMISSIONS.USER_READ)
  async list(
    @CurrentUser() ctx: UserContext,
    @Query(new ZodValidationPipe(NotificationListQueryInput)) query: NotificationListQueryInput,
  ): Promise<NotificationListResponse> {
    return this.notifications.list(ctx.organization.id, ctx.user.id, query);
  }

  @Get('unread-count')
  @RequirePermission(PERMISSIONS.USER_READ)
  async unreadCount(@CurrentUser() ctx: UserContext): Promise<UnreadCountResponse> {
    return { count: await this.notifications.unreadCount(ctx.organization.id, ctx.user.id) };
  }

  @Post(':id/read')
  @RequirePermission(PERMISSIONS.USER_READ)
  async markRead(
    @CurrentUser() ctx: UserContext,
    @Param('id') id: string,
  ): Promise<Notification> {
    return this.notifications.markRead(ctx.organization.id, ctx.user.id, id);
  }

  @Post('read-all')
  @RequirePermission(PERMISSIONS.USER_READ)
  @HttpCode(200)
  async markAllRead(@CurrentUser() ctx: UserContext): Promise<{ updated: number }> {
    return { updated: await this.notifications.markAllRead(ctx.organization.id, ctx.user.id) };
  }
}
