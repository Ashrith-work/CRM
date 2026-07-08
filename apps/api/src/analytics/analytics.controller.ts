import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { PERMISSIONS, type AnalyticsSummary } from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { AnalyticsService } from './analytics.service';
import { RfmRefreshService } from './rfm-refresh.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly rfm: RfmRefreshService,
  ) {}

  /** RFM summary + segment distribution (reads the denormalized features). */
  @Get('summary')
  @RequirePermission(PERMISSIONS.ANALYTICS_READ)
  async summary(@CurrentUser() ctx: UserContext): Promise<AnalyticsSummary> {
    return this.analytics.summary(ctx.organization.id);
  }

  /** Force an RFM refresh for this org now (admin). */
  @Post('refresh')
  @RequirePermission(PERMISSIONS.SEGMENT_MANAGE)
  @HttpCode(200)
  async refresh(@CurrentUser() ctx: UserContext): Promise<{ refreshed: number }> {
    await this.rfm.refreshView();
    return { refreshed: await this.rfm.writeFeaturesForOrg(ctx.organization.id) };
  }
}
