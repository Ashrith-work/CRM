import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  AssignProspectInput,
  LogProgressInput,
  PERMISSIONS,
  ProspectSegmentSchema,
  RecoveryStatusSchema,
  type AssignResult,
  type CoordinationResponse,
  type ProgressListResponse,
  type ProgressUpdateDto,
  type ProspectListResponse,
  type RecoveryMetricsResponse,
} from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { canSeeUnmaskedPii } from '../common/pii.util';
import { RecoveryService } from './recovery.service';

/**
 * Recovery-lead assignment endpoints. Reads need commerce:read; assigning /
 * logging progress needs commerce:manage. PII is unmasked only for pii:read
 * holders — enforced here, server-side, never in the UI.
 */
@Controller('recovery')
export class RecoveryController {
  constructor(private readonly recovery: RecoveryService) {}

  /** Prospect list for a segment (cart_abandoner | non_buyer). */
  @Get('prospects')
  @RequirePermission(PERMISSIONS.COMMERCE_READ)
  prospects(@CurrentUser() ctx: UserContext, @Query('segment') segment?: string): Promise<ProspectListResponse> {
    const parsed = ProspectSegmentSchema.safeParse(segment);
    if (!parsed.success) throw new BadRequestException('segment must be cart_abandoner or non_buyer');
    return this.recovery.listProspects(ctx.organization.id, parsed.data, canSeeUnmaskedPii(ctx.permissions));
  }

  /** Assign / reassign / unassign one or more prospects. */
  @Post('assign')
  @RequirePermission(PERMISSIONS.COMMERCE_MANAGE)
  assign(
    @CurrentUser() ctx: UserContext,
    @Body(new ZodValidationPipe(AssignProspectInput)) body: AssignProspectInput,
  ): Promise<AssignResult> {
    return this.recovery.assign(ctx.organization.id, ctx.user.id, body);
  }

  /** Log a follow-up progress update (status + PII-scrubbed note). */
  @Post('progress')
  @RequirePermission(PERMISSIONS.COMMERCE_MANAGE)
  logProgress(
    @CurrentUser() ctx: UserContext,
    @Body(new ZodValidationPipe(LogProgressInput)) body: LogProgressInput,
  ): Promise<ProgressUpdateDto> {
    return this.recovery.logProgress(ctx.organization.id, ctx.user.id, body);
  }

  /** Follow-up history for one prospect (shows on the customer timeline). */
  @Get('progress')
  @RequirePermission(PERMISSIONS.COMMERCE_READ)
  progress(@CurrentUser() ctx: UserContext, @Query('customerId') customerId?: string): Promise<ProgressListResponse> {
    if (!customerId) throw new BadRequestException('customerId is required');
    return this.recovery.progressFor(ctx.organization.id, customerId);
  }

  /** Office-wide coordination view (who owns which prospect + status + last note). */
  @Get('coordination')
  @RequirePermission(PERMISSIONS.COMMERCE_READ)
  coordination(
    @CurrentUser() ctx: UserContext,
    @Query('ownerUserId') ownerUserId?: string,
    @Query('status') status?: string,
  ): Promise<CoordinationResponse> {
    const parsedStatus = status ? RecoveryStatusSchema.safeParse(status) : null;
    if (parsedStatus && !parsedStatus.success) throw new BadRequestException('invalid status');
    return this.recovery.coordination(ctx.organization.id, canSeeUnmaskedPii(ctx.permissions), {
      ownerUserId: ownerUserId || undefined,
      status: parsedStatus?.success ? parsedStatus.data : undefined,
    });
  }

  /** Assigned-vs-converted per team member. */
  @Get('metrics')
  @RequirePermission(PERMISSIONS.COMMERCE_READ)
  metrics(@CurrentUser() ctx: UserContext): Promise<RecoveryMetricsResponse> {
    return this.recovery.metrics(ctx.organization.id);
  }
}
