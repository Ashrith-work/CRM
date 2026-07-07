import { NotificationService } from './notification.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { EmailProvider } from './email.provider';
import type { PushProvider } from './push.provider';
import type { PushTokensService } from '../push-tokens/push-tokens.service';
import type { NotificationsGateway } from './notifications.gateway';

function savedRow(deliveredChannels: string[]) {
  return {
    id: 'n1',
    organizationId: 'org1',
    userId: 'u1',
    type: 'REMINDER',
    title: 'Reminder: Call',
    body: 'Scheduled',
    relatedType: 'DEAL',
    relatedId: 'd1',
    taskId: 't1',
    readAt: null,
    deliveredChannels,
    createdAt: new Date('2026-07-10T13:00:00.000Z'),
  };
}

describe('NotificationService.fanOut', () => {
  it('creates the in-app row and delivers each requested channel exactly once', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'n1' });
    const update = jest.fn().mockResolvedValue(savedRow(['IN_APP', 'EMAIL', 'PUSH']));
    const count = jest.fn().mockResolvedValue(3);
    const prisma = {
      notification: { create, update, count },
      user: { findFirst: jest.fn().mockResolvedValue({ email: 'rep@example.com' }) },
    } as unknown as PrismaService;

    const emailSend = jest.fn().mockResolvedValue(undefined);
    const email = { send: emailSend } as unknown as EmailProvider;
    const pushSend = jest.fn().mockResolvedValue({ invalidTokens: ['tokBad'] });
    const push = { send: pushSend } as unknown as PushProvider;
    const prune = jest.fn().mockResolvedValue(undefined);
    const pushTokens = {
      tokensForUser: jest.fn().mockResolvedValue([{ token: 'tokBad' }]),
      prune,
    } as unknown as PushTokensService;
    const emitNotification = jest.fn();
    const emitUnreadCount = jest.fn();
    const gateway = { emitNotification, emitUnreadCount } as unknown as NotificationsGateway;

    const service = new NotificationService(prisma, email, push, pushTokens, gateway);
    const result = await service.fanOut({
      organizationId: 'org1',
      userId: 'u1',
      type: 'REMINDER',
      title: 'Reminder: Call',
      body: 'Scheduled',
      taskId: 't1',
      channels: ['IN_APP', 'EMAIL', 'PUSH'],
    });

    // In-app row created once (the durable record) + each side channel once.
    expect(create).toHaveBeenCalledTimes(1);
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(pushSend).toHaveBeenCalledTimes(1);
    // Expo-rejected token pruned.
    expect(prune).toHaveBeenCalledWith(['tokBad']);
    // deliveredChannels records all three.
    expect(update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: { deliveredChannels: ['IN_APP', 'EMAIL', 'PUSH'] },
    });
    // Live in-app: row + fresh unread count pushed to the user's room.
    expect(emitNotification).toHaveBeenCalledTimes(1);
    expect(emitUnreadCount).toHaveBeenCalledWith('org1', 'u1', 3);
    expect(result.id).toBe('n1');
  });

  it('defaults to IN_APP only and does not touch email/push when not requested', async () => {
    const prisma = {
      notification: {
        create: jest.fn().mockResolvedValue({ id: 'n1' }),
        update: jest.fn().mockResolvedValue(savedRow(['IN_APP'])),
        count: jest.fn().mockResolvedValue(1),
      },
      user: { findFirst: jest.fn() },
    } as unknown as PrismaService;
    const emailSend = jest.fn();
    const pushSend = jest.fn();
    const service = new NotificationService(
      prisma,
      { send: emailSend } as unknown as EmailProvider,
      { send: pushSend } as unknown as PushProvider,
      { tokensForUser: jest.fn(), prune: jest.fn() } as unknown as PushTokensService,
      { emitNotification: jest.fn(), emitUnreadCount: jest.fn() } as unknown as NotificationsGateway,
    );

    await service.fanOut({ organizationId: 'org1', userId: 'u1', type: 'SYSTEM', title: 'Hi', body: 'x' });

    expect(emailSend).not.toHaveBeenCalled();
    expect(pushSend).not.toHaveBeenCalled();
  });
});
