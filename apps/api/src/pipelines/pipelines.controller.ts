import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  CreatePipelineInput,
  PERMISSIONS,
  UpdatePipelineInput,
  type Pipeline,
  type PipelineListResponse,
} from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PipelinesService } from './pipelines.service';

@Controller('pipelines')
export class PipelinesController {
  constructor(private readonly pipelines: PipelinesService) {}

  @Get()
  @RequirePermission(PERMISSIONS.PIPELINE_READ)
  async list(@CurrentUser() ctx: UserContext): Promise<PipelineListResponse> {
    return { data: await this.pipelines.list(ctx.organization.id) };
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.PIPELINE_READ)
  async get(@CurrentUser() ctx: UserContext, @Param('id') id: string): Promise<Pipeline> {
    return this.pipelines.get(ctx.organization.id, id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.PIPELINE_MANAGE)
  async create(
    @CurrentUser() ctx: UserContext,
    @Body(new ZodValidationPipe(CreatePipelineInput)) body: CreatePipelineInput,
  ): Promise<Pipeline> {
    return this.pipelines.create(ctx.organization.id, body);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.PIPELINE_MANAGE)
  async update(
    @CurrentUser() ctx: UserContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdatePipelineInput)) body: UpdatePipelineInput,
  ): Promise<Pipeline> {
    return this.pipelines.update(ctx.organization.id, id, body);
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.PIPELINE_MANAGE)
  @HttpCode(204)
  async remove(@CurrentUser() ctx: UserContext, @Param('id') id: string): Promise<void> {
    await this.pipelines.remove(ctx.organization.id, id);
  }
}
