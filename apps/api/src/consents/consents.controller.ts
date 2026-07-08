import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  PERMISSIONS,
  SetConsentInput,
  type Consent,
  type ConsentListResponse,
} from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ConsentService } from './consent.service';

@Controller('consents')
export class ConsentsController {
  constructor(private readonly consents: ConsentService) {}

  /** List a contact's consent records. */
  @Get()
  @RequirePermission(PERMISSIONS.CONSENT_READ)
  async list(
    @CurrentUser() ctx: UserContext,
    @Query('contactId') contactId: string,
  ): Promise<ConsentListResponse> {
    return { data: await this.consents.list(ctx.organization.id, contactId) };
  }

  /** Grant or withdraw consent. Withdrawing enqueues a purge of stored recordings. */
  @Post()
  @RequirePermission(PERMISSIONS.CONSENT_MANAGE)
  async set(
    @CurrentUser() ctx: UserContext,
    @Body(new ZodValidationPipe(SetConsentInput)) body: SetConsentInput,
  ): Promise<Consent> {
    return this.consents.set(ctx.organization.id, body.contactId, body.purpose, body.status, body.source);
  }
}
