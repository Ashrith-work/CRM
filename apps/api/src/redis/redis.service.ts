import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import IORedis, { type Redis } from 'ioredis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * Thin wrapper over an ioredis connection. Used for the health probe and as
 * evidence Redis is reachable; BullMQ uses its own connection (see RedisModule).
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async isHealthy(): Promise<boolean> {
    try {
      const pong = await this.client.ping();
      return pong === 'PONG';
    } catch (err) {
      this.logger.warn(`Redis ping failed: ${(err as Error).message}`);
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}

export function createRedisClient(url: string): Redis {
  return new IORedis(url, { maxRetriesPerRequest: null, lazyConnect: false });
}
