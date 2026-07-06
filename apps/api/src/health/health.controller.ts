import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@crm/types';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @Public()
  async check(): Promise<HealthResponse> {
    const [dbUp, redisUp] = await Promise.all([
      this.prisma.isHealthy(),
      this.redis.isHealthy(),
    ]);

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        database: dbUp ? 'up' : 'down',
        redis: redisUp ? 'up' : 'down',
      },
    };
  }
}
