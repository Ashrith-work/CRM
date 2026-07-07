import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/**
 * Read-only dashboard/reporting. Aggregates over M1–M3 data (no new tables),
 * cached in Redis. Depends on UsersModule for the requester's timezone; Prisma
 * and Redis are global.
 */
@Module({
  imports: [UsersModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
