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
import { PushTokensModule } from './push-tokens/push-tokens.module';
import { NotificationsModule } from './notifications/notifications.module';
import { TasksModule } from './tasks/tasks.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { TelephonyModule } from './telephony/telephony.module';
import { ConsentsModule } from './consents/consents.module';
import { RecordingsModule } from './recordings/recordings.module';
import { CallsModule } from './calls/calls.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { CustomersModule } from './customers/customers.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { CampaignsModule } from './campaigns/campaigns.module';
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
    // Milestone 3 — activity, reminders, notifications. PushTokens/Notifications
    // register before Tasks (the reminder send worker depends on them).
    PushTokensModule,
    NotificationsModule,
    TasksModule,
    // Milestone 4 — read-only dashboard/reporting over M1–M3 data.
    DashboardModule,
    // Milestone 5 — call management. Telephony is global; Consents/Recordings
    // register before Calls (dependency order).
    TelephonyModule,
    ConsentsModule,
    RecordingsModule,
    CallsModule,
    // M0 retrofit — integrations directory (Configure).
    IntegrationsModule,
    // M1 commerce — Shopify ingestion (customers/identity + ingestion worker).
    CustomersModule,
    IngestionModule,
    // M3 — RFM analytics (materialized view + nightly worker) + segmentation.
    AnalyticsModule,
    // M4 — abandoned-cart recovery (the closed loop / MVP ship line).
    CampaignsModule,
  ],
  providers: [
    // Order matters: authenticate first, then authorize.
    { provide: APP_GUARD, useClass: ClerkAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
