import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  CreateTagInput,
  PERMISSIONS,
  TagAssignmentInput,
  UpdateTagInput,
  type Tag,
  type TagListResponse,
} from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TagsService } from './tags.service';

@Controller('tags')
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  @Get()
  @RequirePermission(PERMISSIONS.TAG_READ)
  async list(@CurrentUser() ctx: UserContext): Promise<TagListResponse> {
    return { data: await this.tags.list(ctx.organization.id) };
  }

  @Post()
  @RequirePermission(PERMISSIONS.TAG_MANAGE)
  async create(
    @CurrentUser() ctx: UserContext,
    @Body(new ZodValidationPipe(CreateTagInput)) body: CreateTagInput,
  ): Promise<Tag> {
    return this.tags.create(ctx.organization.id, body);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.TAG_MANAGE)
  async update(
    @CurrentUser() ctx: UserContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateTagInput)) body: UpdateTagInput,
  ): Promise<Tag> {
    return this.tags.update(ctx.organization.id, id, body);
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.TAG_MANAGE)
  @HttpCode(204)
  async remove(@CurrentUser() ctx: UserContext, @Param('id') id: string): Promise<void> {
    await this.tags.remove(ctx.organization.id, id);
  }

  /** Assign a tag to an entity. */
  @Post('assign')
  @RequirePermission(PERMISSIONS.TAG_MANAGE)
  @HttpCode(204)
  async assign(
    @CurrentUser() ctx: UserContext,
    @Body(new ZodValidationPipe(TagAssignmentInput)) body: TagAssignmentInput,
  ): Promise<void> {
    await this.tags.assign(ctx.organization.id, body, ctx.user.id);
  }

  /** Remove a tag from an entity. */
  @Post('unassign')
  @RequirePermission(PERMISSIONS.TAG_MANAGE)
  @HttpCode(204)
  async unassign(
    @CurrentUser() ctx: UserContext,
    @Body(new ZodValidationPipe(TagAssignmentInput)) body: TagAssignmentInput,
  ): Promise<void> {
    await this.tags.unassign(ctx.organization.id, body);
  }
}
