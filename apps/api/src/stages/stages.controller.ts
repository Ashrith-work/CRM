import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  CreateStageInput,
  PERMISSIONS,
  ReorderStagesInput,
  UpdateStageInput,
  type Stage,
} from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { StagesService } from './stages.service';

@Controller('stages')
export class StagesController {
  constructor(private readonly stages: StagesService) {}

  /** GET /api/v1/stages?pipelineId=... */
  @Get()
  @RequirePermission(PERMISSIONS.PIPELINE_READ)
  async list(
    @CurrentUser() ctx: UserContext,
    @Query('pipelineId') pipelineId: string,
  ): Promise<{ data: Stage[] }> {
    return { data: await this.stages.listForPipeline(ctx.organization.id, pipelineId) };
  }

  @Post()
  @RequirePermission(PERMISSIONS.PIPELINE_MANAGE)
  async create(
    @CurrentUser() ctx: UserContext,
    @Body(new ZodValidationPipe(CreateStageInput)) body: CreateStageInput,
  ): Promise<Stage> {
    return this.stages.create(ctx.organization.id, body);
  }

  /** Reorder must be declared before ':id' so it isn't captured as an id. */
  @Post('reorder')
  @RequirePermission(PERMISSIONS.PIPELINE_MANAGE)
  async reorder(
    @CurrentUser() ctx: UserContext,
    @Body(new ZodValidationPipe(ReorderStagesInput)) body: ReorderStagesInput,
  ): Promise<{ data: Stage[] }> {
    return { data: await this.stages.reorder(ctx.organization.id, body) };
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.PIPELINE_MANAGE)
  async update(
    @CurrentUser() ctx: UserContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateStageInput)) body: UpdateStageInput,
  ): Promise<Stage> {
    return this.stages.update(ctx.organization.id, id, body);
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.PIPELINE_MANAGE)
  @HttpCode(204)
  async remove(@CurrentUser() ctx: UserContext, @Param('id') id: string): Promise<void> {
    await this.stages.remove(ctx.organization.id, id);
  }
}
