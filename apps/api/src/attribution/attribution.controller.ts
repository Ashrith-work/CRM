import { Controller, Get, Query } from '@nestjs/common';
import {
  PERMISSIONS,
  AttributionModelSchema,
  type AttributionModel,
  type OrderCoverageResponse,
  type ReconciliationResponse,
  type SourceRoiResponse,
} from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { AttributionService } from './attribution.service';

/**
 * Attribution reads (LTV-by-source, coverage, Meta-vs-store reconciliation).
 * All ADS_READ. The attribution model is a query param, DEFAULT first-touch,
 * and always echoed back so the UI can label it.
 */
@Controller('attribution')
export class AttributionController {
  constructor(private readonly attribution: AttributionService) {}

  @Get('source-roi')
  @RequirePermission(PERMISSIONS.ADS_READ)
  async sourceRoi(@CurrentUser() ctx: UserContext, @Query('model') model?: string): Promise<SourceRoiResponse> {
    const parsed: AttributionModel = AttributionModelSchema.catch('first_touch').parse(model ?? 'first_touch');
    return this.attribution.sourceRoi(ctx.organization.id, parsed);
  }

  @Get('coverage')
  @RequirePermission(PERMISSIONS.ADS_READ)
  async coverage(@CurrentUser() ctx: UserContext): Promise<{ coveragePct: number }> {
    return { coveragePct: await this.attribution.coveragePct(ctx.organization.id) };
  }

  /** Order-level coverage: orders with a known first-touch source ÷ all orders. */
  @Get('order-coverage')
  @RequirePermission(PERMISSIONS.ADS_READ)
  async orderCoverage(@CurrentUser() ctx: UserContext): Promise<OrderCoverageResponse> {
    return this.attribution.orderCoverage(ctx.organization.id);
  }

  @Get('reconciliation')
  @RequirePermission(PERMISSIONS.ADS_READ)
  async reconciliation(@CurrentUser() ctx: UserContext): Promise<ReconciliationResponse> {
    return this.attribution.reconciliation(ctx.organization.id);
  }
}
