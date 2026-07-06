import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { REDIS_CLIENT, RedisService, createRedisClient } from './redis.service';

/**
 * Wires Redis + BullMQ. No jobs are registered yet (Milestone 0) — the point is
 * a proven, injectable connection that later milestones enqueue onto.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // Cast: ioredis may be deduplicated to two identical copies in the
        // workspace, which clash nominally. Runtime types are the same version.
        connection: new IORedis(config.getOrThrow<string>('REDIS_URL'), {
          maxRetriesPerRequest: null,
        }) as unknown as ConnectionOptions,
      }),
    }),
    // Placeholder queue proves the BullMQ wiring end-to-end.
    BullModule.registerQueue({ name: 'system' }),
  ],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createRedisClient(config.getOrThrow<string>('REDIS_URL')),
    },
    RedisService,
  ],
  exports: [RedisService, BullModule],
})
export class RedisModule {}
