import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  PERMISSIONS,
  ConnectMetaInput,
  type AdPerformanceResponse,
  type MetaStatus,
  type SyncNowResponse,
} from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { MetaConnectService } from './meta-connect.service';
import { AttributionService } from '../attribution/attribution.service';

/**
 * Meta connect + status + sync + ad performance. Reads are ADS_READ; connecting
 * Meta and forcing a sync are ADS_MANAGE. The system-user token is never in the
 * request body — only non-secret adAccountId/businessId.
 */
@Controller('ads')
export class AdsController {
  constructor(
    private readonly connect: MetaConnectService,
    private readonly attribution: AttributionService,
  ) {}

  @Get('status')
  @RequirePermission(PERMISSIONS.ADS_READ)
  async status(@CurrentUser() ctx: UserContext): Promise<MetaStatus> {
    return this.connect.status(ctx.organization.id);
  }

  @Post('connect')
  @RequirePermission(PERMISSIONS.ADS_MANAGE)
  async connectMeta(
    @CurrentUser() ctx: UserContext,
    @Body(new ZodValidationPipe(ConnectMetaInput)) body: ConnectMetaInput,
  ): Promise<MetaStatus> {
    return this.connect.connect(ctx.organization.id, ctx.user.id, body);
  }

  @Post('sync-now')
  @RequirePermission(PERMISSIONS.ADS_MANAGE)
  @HttpCode(200)
  async syncNow(@CurrentUser() ctx: UserContext): Promise<SyncNowResponse> {
    return this.connect.syncNow(ctx.organization.id);
  }

  @Post('disconnect')
  @RequirePermission(PERMISSIONS.ADS_MANAGE)
  @HttpCode(200)
  async disconnect(@CurrentUser() ctx: UserContext): Promise<MetaStatus> {
    return this.connect.disconnect(ctx.organization.id);
  }

  @Get('performance')
  @RequirePermission(PERMISSIONS.ADS_READ)
  async performance(@CurrentUser() ctx: UserContext): Promise<AdPerformanceResponse> {
    return this.attribution.adPerformance(ctx.organization.id);
  }
}
