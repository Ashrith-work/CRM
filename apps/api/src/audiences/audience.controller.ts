import { Body, Controller, Get, Post } from '@nestjs/common';
import { PERMISSIONS, SyncAudienceInput, type AudienceSyncDto, type AudienceSyncListResponse } from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AudienceService } from './audience.service';

/**
 * Segment → Meta audience sync. Listing is ADS_READ; pushing (consented-only)
 * is ADS_MANAGE. The push itself is ConsentGate-gated in the service.
 */
@Controller('audiences')
export class AudienceController {
  constructor(private readonly audiences: AudienceService) {}

  @Get()
  @RequirePermission(PERMISSIONS.ADS_READ)
  async list(@CurrentUser() ctx: UserContext): Promise<AudienceSyncListResponse> {
    return { data: await this.audiences.list(ctx.organization.id) };
  }

  @Post('sync')
  @RequirePermission(PERMISSIONS.ADS_MANAGE)
  async sync(
    @CurrentUser() ctx: UserContext,
    @Body(new ZodValidationPipe(SyncAudienceInput)) body: SyncAudienceInput,
  ): Promise<AudienceSyncDto> {
    return this.audiences.sync(ctx.organization.id, ctx.user.id, body);
  }
}
