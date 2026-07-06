import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  CreateDealInput,
  DealListQueryInput,
  MoveDealInput,
  PERMISSIONS,
  ReopenDealInput,
  UpdateDealInput,
  type Deal,
  type DealListResponse,
  type StageHistoryListResponse,
} from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DealsService } from './deals.service';

@Controller('deals')
export class DealsController {
  constructor(private readonly deals: DealsService) {}

  @Get()
  @RequirePermission(PERMISSIONS.DEAL_READ)
  async list(
    @CurrentUser() ctx: UserContext,
    @Query(new ZodValidationPipe(DealListQueryInput)) query: DealListQueryInput,
  ): Promise<DealListResponse> {
    return this.deals.list(ctx.organization.id, query);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.DEAL_READ)
  async get(@CurrentUser() ctx: UserContext, @Param('id') id: string): Promise<Deal> {
    return this.deals.get(ctx.organization.id, id);
  }

  @Get(':id/history')
  @RequirePermission(PERMISSIONS.DEAL_READ)
  async history(
    @CurrentUser() ctx: UserContext,
    @Param('id') id: string,
  ): Promise<StageHistoryListResponse> {
    return { data: await this.deals.stageHistory(ctx.organization.id, id) };
  }

  @Post()
  @RequirePermission(PERMISSIONS.DEAL_MANAGE)
  async create(
    @CurrentUser() ctx: UserContext,
    @Body(new ZodValidationPipe(CreateDealInput)) body: CreateDealInput,
  ): Promise<Deal> {
    return this.deals.create(ctx.organization.id, body, ctx.user.id);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.DEAL_MANAGE)
  async update(
    @CurrentUser() ctx: UserContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateDealInput)) body: UpdateDealInput,
  ): Promise<Deal> {
    return this.deals.update(ctx.organization.id, id, body, ctx.user.id);
  }

  @Post(':id/move')
  @RequirePermission(PERMISSIONS.DEAL_MANAGE)
  async move(
    @CurrentUser() ctx: UserContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(MoveDealInput)) body: MoveDealInput,
  ): Promise<Deal> {
    return this.deals.move(ctx.organization.id, id, body, ctx.user.id);
  }

  @Post(':id/reopen')
  @RequirePermission(PERMISSIONS.DEAL_MANAGE)
  async reopen(
    @CurrentUser() ctx: UserContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReopenDealInput)) body: ReopenDealInput,
  ): Promise<Deal> {
    return this.deals.reopen(ctx.organization.id, id, body, ctx.user.id);
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.DEAL_MANAGE)
  @HttpCode(204)
  async remove(@CurrentUser() ctx: UserContext, @Param('id') id: string): Promise<void> {
    await this.deals.remove(ctx.organization.id, id);
  }
}
