import { Controller, Get, Query } from '@nestjs/common';
import {
  DashboardFunnelQueryInput,
  DashboardSalesQueryInput,
  DashboardTeamQueryInput,
  DashboardTrendsQueryInput,
  PERMISSIONS,
  type FunnelResponse,
  type SalesTiles,
  type TeamResponse,
  type TrendsResponse,
} from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DashboardService } from './dashboard.service';

/**
 * Read-only sales dashboard. Every endpoint is org-scoped and role-scoped; the
 * data scope (own/team/all) is derived from the caller's dashboard permissions
 * inside the service. Payloads are Redis-cached with a short TTL.
 */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('sales')
  @RequirePermission(PERMISSIONS.DASHBOARD_READ)
  async sales(
    @CurrentUser() ctx: UserContext,
    @Query(new ZodValidationPipe(DashboardSalesQueryInput)) query: DashboardSalesQueryInput,
  ): Promise<SalesTiles> {
    return this.dashboard.sales(this.ctx(ctx), query);
  }

  @Get('funnel')
  @RequirePermission(PERMISSIONS.DASHBOARD_READ)
  async funnel(
    @CurrentUser() ctx: UserContext,
    @Query(new ZodValidationPipe(DashboardFunnelQueryInput)) query: DashboardFunnelQueryInput,
  ): Promise<FunnelResponse> {
    return this.dashboard.funnel(this.ctx(ctx), query);
  }

  // Managers/owner only — reps get 403 (they lack dashboard:read_team).
  @Get('team')
  @RequirePermission(PERMISSIONS.DASHBOARD_READ_TEAM)
  async team(
    @CurrentUser() ctx: UserContext,
    @Query(new ZodValidationPipe(DashboardTeamQueryInput)) query: DashboardTeamQueryInput,
  ): Promise<TeamResponse> {
    return this.dashboard.team(this.ctx(ctx), query);
  }

  @Get('trends')
  @RequirePermission(PERMISSIONS.DASHBOARD_READ)
  async trends(
    @CurrentUser() ctx: UserContext,
    @Query(new ZodValidationPipe(DashboardTrendsQueryInput)) query: DashboardTrendsQueryInput,
  ): Promise<TrendsResponse> {
    return this.dashboard.trends(this.ctx(ctx), query);
  }

  private ctx(ctx: UserContext) {
    return { organizationId: ctx.organization.id, userId: ctx.user.id, permissions: ctx.permissions };
  }
}
