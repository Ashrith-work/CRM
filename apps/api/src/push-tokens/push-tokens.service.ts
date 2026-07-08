import { Injectable, Logger } from '@nestjs/common';
import type { PushPlatform, PushToken as PushTokenDto } from '@crm/types';
import type { PushToken as PushTokenRow } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Expo push-token registry. Tokens are UNIQUE(token) and hard-deleted on
 * unregister / prune (mirrors the Taggable convention) so re-registration is
 * always clean and DeviceNotRegistered tokens never linger.
 */
@Injectable()
export class PushTokensService {
  private readonly logger = new Logger(PushTokensService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Idempotent register/refresh. Re-points a token to the current user if the
   * device was previously signed in as someone else. */
  async register(
    organizationId: string,
    userId: string,
    token: string,
    platform: PushPlatform,
  ): Promise<PushTokenDto> {
    const row = await this.prisma.pushToken.upsert({
      where: { token },
      update: { organizationId, userId, platform, lastSeenAt: new Date(), deletedAt: null },
      create: { organizationId, userId, token, platform },
    });
    return serializePushToken(row);
  }

  async unregister(userId: string, token: string): Promise<void> {
    await this.prisma.pushToken.deleteMany({ where: { token, userId } });
  }

  /** Active tokens for a recipient (used by the push channel adapter). */
  async tokensForUser(organizationId: string, userId: string): Promise<PushTokenRow[]> {
    return this.prisma.pushToken.findMany({ where: { organizationId, userId } });
  }

  /** Remove tokens Expo reported as DeviceNotRegistered. */
  async prune(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;
    const { count } = await this.prisma.pushToken.deleteMany({ where: { token: { in: tokens } } });
    if (count > 0) this.logger.log(`Pruned ${count} stale push token(s)`);
  }
}

function serializePushToken(row: PushTokenRow): PushTokenDto {
  return {
    id: row.id,
    userId: row.userId,
    token: row.token,
    platform: row.platform,
    lastSeenAt: row.lastSeenAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
