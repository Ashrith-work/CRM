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

  /**
   * Read a cached JSON value. Returns null on a miss OR any Redis error — the
   * cache is an optimization, never a correctness dependency, so a cache
   * failure must degrade to a live recompute rather than fail the request.
   */
  async cacheGet<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.client.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (err) {
      this.logger.warn(`cacheGet(${key}) failed: ${(err as Error).message}`);
      return null;
    }
  }

  /** Write a JSON value with a TTL (seconds). Swallows errors (best-effort). */
  async cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err) {
      this.logger.warn(`cacheSet(${key}) failed: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}

export function createRedisClient(url: string): Redis {
  return new IORedis(url, { maxRetriesPerRequest: null, lazyConnect: false });
}
