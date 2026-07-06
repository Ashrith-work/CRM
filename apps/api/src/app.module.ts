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
import { ActivityModule } from './activity/activity.module';
import { TagsModule } from './tags/tags.module';
import { CustomFieldsModule } from './custom-fields/custom-fields.module';
import { NotesModule } from './notes/notes.module';
import { CompaniesModule } from './companies/companies.module';
import { ContactsModule } from './contacts/contacts.module';
import { LeadsModule } from './leads/leads.module';
import { StagesModule } from './stages/stages.module';
import { PipelinesModule } from './pipelines/pipelines.module';
import { DealsModule } from './deals/deals.module';
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
    // Milestone 1 — CRM. Global modules (Activity/Tags/CustomFields) first so
    // their exported services are available to the entity modules.
    ActivityModule,
    TagsModule,
    CustomFieldsModule,
    NotesModule,
    CompaniesModule,
    ContactsModule,
    LeadsModule,
    // Milestone 2 — revenue layer. Stages/Pipelines are global; register before Deals.
    StagesModule,
    PipelinesModule,
    DealsModule,
  ],
  providers: [
    // Order matters: authenticate first, then authorize.
    { provide: APP_GUARD, useClass: ClerkAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
