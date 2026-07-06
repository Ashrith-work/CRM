import { Controller, Get, Query } from '@nestjs/common';
import { FeedQueryInput, PERMISSIONS, type ActivityListResponse } from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ActivityService } from './activity.service';

@Controller('activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  /** GET /api/v1/activity?entityType=CONTACT&entityId=... — newest-first feed. */
  @Get()
  @RequirePermission(PERMISSIONS.ACTIVITY_READ)
  async list(
    @CurrentUser() ctx: UserContext,
    @Query(new ZodValidationPipe(FeedQueryInput)) query: FeedQueryInput,
  ): Promise<ActivityListResponse> {
    return this.activity.list(ctx.organization.id, query);
  }
}
