import { Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import {
  KpiQueryInput,
  PERMISSIONS,
  type AnalyticsSummary,
  type ChurnWatchlistResponse,
  type ClvDistributionResponse,
  type CohortResponse,
  type KpiResponse,
  type MarginResponse,
  type RevenueTrendResponse,
} from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { canSeeUnmaskedPii } from '../common/pii.util';
import { AnalyticsService } from './analytics.service';
import { KpiService } from './kpi.service';
import { RfmRefreshService } from './rfm-refresh.service';
import { ChurnScoreService } from './churn-score.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly kpi: KpiService,
    private readonly rfm: RfmRefreshService,
    private readonly churn: ChurnScoreService,
  ) {}

  /** Commerce KPI tiles from the ingested Shopify data (period-scoped, cached). */
  @Get('kpis')
  @RequirePermission(PERMISSIONS.ANALYTICS_READ)
  async kpis(
    @CurrentUser() ctx: UserContext,
    @Query(new ZodValidationPipe(KpiQueryInput)) query: KpiQueryInput,
  ): Promise<KpiResponse> {
    return this.kpi.kpis(ctx.organization.id, query);
  }

  /** RFM summary + segment distribution (reads the denormalized features). */
  @Get('summary')
  @RequirePermission(PERMISSIONS.ANALYTICS_READ)
  async summary(@CurrentUser() ctx: UserContext): Promise<AnalyticsSummary> {
    return this.analytics.summary(ctx.organization.id);
  }

  @Get('revenue-trend')
  @RequirePermission(PERMISSIONS.ANALYTICS_READ)
  async revenueTrend(@CurrentUser() ctx: UserContext): Promise<RevenueTrendResponse> {
    return this.analytics.revenueTrend(ctx.organization.id);
  }

  @Get('cohorts')
  @RequirePermission(PERMISSIONS.ANALYTICS_READ)
  async cohorts(@CurrentUser() ctx: UserContext): Promise<CohortResponse> {
    return this.analytics.cohorts(ctx.organization.id);
  }

  @Get('clv-distribution')
  @RequirePermission(PERMISSIONS.ANALYTICS_READ)
  async clv(@CurrentUser() ctx: UserContext): Promise<ClvDistributionResponse> {
    return this.analytics.clvDistribution(ctx.organization.id);
  }

  @Get('churn-watchlist')
  @RequirePermission(PERMISSIONS.ANALYTICS_READ)
  async churnWatchlist(@CurrentUser() ctx: UserContext): Promise<ChurnWatchlistResponse> {
    return this.analytics.churnWatchlist(ctx.organization.id, canSeeUnmaskedPii(ctx.permissions));
  }

  @Get('margin')
  @RequirePermission(PERMISSIONS.ANALYTICS_READ)
  async margin(@CurrentUser() ctx: UserContext): Promise<MarginResponse> {
    return this.analytics.margin(ctx.organization.id);
  }

  /** Force a full analytics refresh (views + RFM/CLV + churn) for this org now. */
  @Post('refresh')
  @RequirePermission(PERMISSIONS.SEGMENT_MANAGE)
  @HttpCode(200)
  async refresh(@CurrentUser() ctx: UserContext): Promise<{ refreshed: number }> {
    await this.rfm.refreshView();
    await this.rfm.refreshAnalyticsViews();
    const refreshed = await this.rfm.writeFeaturesForOrg(ctx.organization.id);
    await this.rfm.writeClvForOrg(ctx.organization.id);
    await this.churn.scoreOrg(ctx.organization.id);
    return { refreshed };
  }
}
