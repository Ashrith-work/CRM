import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  ConnectShopifyInput,
  PERMISSIONS,
  type ShopifyStatus,
  type SyncNowResponse,
} from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { IngestionService } from './ingestion.service';

/** Shopify connection + sync management (the Settings panel). Admin-only. */
@Controller('ingestion/shopify')
export class IngestionController {
  constructor(private readonly ingestion: IngestionService) {}

  @Post('connect')
  @RequirePermission(PERMISSIONS.COMMERCE_MANAGE)
  async connect(
    @CurrentUser() ctx: UserContext,
    @Body(new ZodValidationPipe(ConnectShopifyInput)) body: ConnectShopifyInput,
  ): Promise<ShopifyStatus> {
    return this.ingestion.connect(ctx.organization.id, ctx.user.id, body);
  }

  @Get('status')
  @RequirePermission(PERMISSIONS.COMMERCE_READ)
  async status(@CurrentUser() ctx: UserContext): Promise<ShopifyStatus> {
    return this.ingestion.status(ctx.organization.id);
  }

  @Post('sync-now')
  @RequirePermission(PERMISSIONS.COMMERCE_MANAGE)
  async syncNow(@CurrentUser() ctx: UserContext): Promise<SyncNowResponse> {
    return this.ingestion.syncNow(ctx.organization.id);
  }
}
