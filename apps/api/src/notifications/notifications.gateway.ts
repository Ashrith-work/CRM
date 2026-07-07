import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { NOTIFICATIONS_NAMESPACE, SOCKET_EVENTS, type Notification } from '@crm/types';
import { ClerkService } from '../auth/clerk.service';
import { UserContextService } from '../auth/user-context.service';
import { PrismaService } from '../prisma/prisma.service';

/** Per-user Socket.io room name (org-scoped to avoid any cross-tenant bleed). */
export function userRoom(organizationId: string, userId: string): string {
  return `org:${organizationId}:user:${userId}`;
}

/**
 * Realtime notifications gateway. On connect it authenticates the socket with
 * the Clerk token (from handshake auth/headers/query), joins the client to its
 * per-user room, and pushes the current unread count. NotificationService emits
 * new notifications + unread counts into these rooms.
 */
@WebSocketGateway({ namespace: NOTIFICATIONS_NAMESPACE, cors: { origin: true, credentials: true } })
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly clerk: ClerkService,
    private readonly userContext: UserContextService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = this.extractToken(client);
      if (!token) throw new Error('missing token');

      const claims = await this.clerk.verifyToken(token);
      if (!claims?.sub) throw new Error('invalid claims');

      const ctx = await this.userContext.resolve(claims.sub, claims.org_id ?? null);
      if (!ctx) throw new Error('not provisioned');

      client.data.userId = ctx.user.id;
      client.data.organizationId = ctx.organization.id;
      await client.join(userRoom(ctx.organization.id, ctx.user.id));

      // Push the current unread count immediately so the bell is correct on load.
      const count = await this.prisma.notification.count({
        where: { organizationId: ctx.organization.id, userId: ctx.user.id, readAt: null, deletedAt: null },
      });
      client.emit(SOCKET_EVENTS.unreadCount, { count });
    } catch (err) {
      this.logger.debug(`Rejecting socket ${client.id}: ${(err as Error).message}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    // Rooms are cleaned up by socket.io automatically; nothing to do.
    void client;
  }

  /** Emit a freshly created notification to its recipient's room. */
  emitNotification(organizationId: string, userId: string, notification: Notification): void {
    this.server?.to(userRoom(organizationId, userId)).emit(SOCKET_EVENTS.notification, notification);
  }

  /** Emit the recipient's current unread count. */
  emitUnreadCount(organizationId: string, userId: string, count: number): void {
    this.server?.to(userRoom(organizationId, userId)).emit(SOCKET_EVENTS.unreadCount, { count });
  }

  private extractToken(client: Socket): string | null {
    const auth = client.handshake.auth as { token?: string } | undefined;
    if (auth?.token) return auth.token;
    const header = client.handshake.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    const q = client.handshake.query?.token;
    if (typeof q === 'string' && q) return q;
    return null;
  }
}
