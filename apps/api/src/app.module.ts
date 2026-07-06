import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { validateEnv } from './config/env';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { HealthModule } from './health/health.module';
import { UsersModule } from './users/users.module';
import { ClerkAuthGuard } from './auth/clerk-auth.guard';
import { PermissionsGuard } from './rbac/permissions.guard';
import { AuditInterceptor } from './audit/audit.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    PrismaModule,
    RedisModule,
    AuthModule,
    AuditModule,
    HealthModule,
    UsersModule,
  ],
  providers: [
    // Order matters: authenticate first, then authorize.
    { provide: APP_GUARD, useClass: ClerkAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
