import { Controller, Get, Inject } from '@nestjs/common';
import type { HealthResponse } from '@crm/types';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { TELEPHONY_PROVIDER, type TelephonyProvider } from '../telephony/telephony.provider';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(TELEPHONY_PROVIDER) private readonly telephony: TelephonyProvider,
  ) {}

  @Get()
  @Public()
  async check(): Promise<HealthResponse> {
    const [dbUp, redisUp, telephony] = await Promise.all([
      this.prisma.isHealthy(),
      this.redis.isHealthy(),
      this.telephony.healthCheck().catch(() => 'down' as const),
    ]);

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        database: dbUp ? 'up' : 'down',
        redis: redisUp ? 'up' : 'down',
        telephony,
      },
    };
  }
}
