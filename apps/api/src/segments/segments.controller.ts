import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  PERMISSIONS,
  SaveSegmentInput,
  SegmentPreviewInput,
  type Segment,
  type SegmentListResponse,
  type SegmentMembersResponse,
  type SegmentPreviewResponse,
} from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { canSeeUnmaskedPii } from '../common/pii.util';
import { SegmentService } from './segment.service';

@Controller('segments')
export class SegmentsController {
  constructor(private readonly segments: SegmentService) {}

  /** Live count + 20-row sample as rules change (< 2s). */
  @Post('preview')
  @RequirePermission(PERMISSIONS.SEGMENT_READ)
  async preview(
    @CurrentUser() ctx: UserContext,
    @Body(new ZodValidationPipe(SegmentPreviewInput)) body: SegmentPreviewInput,
  ): Promise<SegmentPreviewResponse> {
    return this.segments.preview(ctx.organization.id, body.rules, canSeeUnmaskedPii(ctx.permissions));
  }

  @Post()
  @RequirePermission(PERMISSIONS.SEGMENT_MANAGE)
  async save(
    @CurrentUser() ctx: UserContext,
    @Body(new ZodValidationPipe(SaveSegmentInput)) body: SaveSegmentInput,
  ): Promise<Segment> {
    return this.segments.save(ctx.organization.id, ctx.user.id, body);
  }

  @Get()
  @RequirePermission(PERMISSIONS.SEGMENT_READ)
  async list(@CurrentUser() ctx: UserContext): Promise<SegmentListResponse> {
    return { data: await this.segments.list(ctx.organization.id) };
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.SEGMENT_READ)
  async get(@CurrentUser() ctx: UserContext, @Param('id') id: string): Promise<Segment> {
    return this.segments.get(ctx.organization.id, id);
  }

  @Get(':id/members')
  @RequirePermission(PERMISSIONS.SEGMENT_READ)
  async members(
    @CurrentUser() ctx: UserContext,
    @Param('id') id: string,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
  ): Promise<SegmentMembersResponse> {
    const take = Math.min(100, Math.max(1, Number(limit) || 50));
    return this.segments.members(ctx.organization.id, id, cursor, take, canSeeUnmaskedPii(ctx.permissions));
  }

  /** Recompute a dynamic segment's membership now (admin). */
  @Post(':id/refresh')
  @RequirePermission(PERMISSIONS.SEGMENT_MANAGE)
  async refresh(@CurrentUser() ctx: UserContext, @Param('id') id: string): Promise<Segment> {
    const segment = await this.segments.get(ctx.organization.id, id);
    await this.segments.recompute(ctx.organization.id, id, segment.rules as never);
    return this.segments.get(ctx.organization.id, id);
  }
}
