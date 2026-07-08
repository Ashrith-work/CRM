import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  CallListQueryInput,
  ClickToCallInput,
  LogCallInput,
  PERMISSIONS,
  UpdateCallInput,
  type Call,
  type CallListResponse,
  type RecordingUrlResponse,
} from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CallsService } from './calls.service';

@Controller('calls')
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  @Post('click-to-call')
  @RequirePermission(PERMISSIONS.CALL_MANAGE)
  async clickToCall(
    @CurrentUser() ctx: UserContext,
    @Body(new ZodValidationPipe(ClickToCallInput)) body: ClickToCallInput,
  ): Promise<Call> {
    return this.calls.clickToCall(ctx.organization.id, ctx.user.id, body);
  }

  /** Manually log a call (mobile "log a call"). */
  @Post()
  @RequirePermission(PERMISSIONS.CALL_MANAGE)
  async log(
    @CurrentUser() ctx: UserContext,
    @Body(new ZodValidationPipe(LogCallInput)) body: LogCallInput,
  ): Promise<Call> {
    return this.calls.log(ctx.organization.id, ctx.user.id, body);
  }

  @Get()
  @RequirePermission(PERMISSIONS.CALL_READ)
  async list(
    @CurrentUser() ctx: UserContext,
    @Query(new ZodValidationPipe(CallListQueryInput)) query: CallListQueryInput,
  ): Promise<CallListResponse> {
    return this.calls.list(ctx.organization.id, ctx.user.id, query);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.CALL_READ)
  async get(@CurrentUser() ctx: UserContext, @Param('id') id: string): Promise<Call> {
    return this.calls.get(ctx.organization.id, id);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.CALL_MANAGE)
  async update(
    @CurrentUser() ctx: UserContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCallInput)) body: UpdateCallInput,
  ): Promise<Call> {
    return this.calls.update(ctx.organization.id, id, body, ctx.user.id);
  }

  /** A short-lived signed recording URL — consent-gated (403-equivalent via a null url). */
  @Get(':id/recording')
  @RequirePermission(PERMISSIONS.CALL_READ)
  async recording(
    @CurrentUser() ctx: UserContext,
    @Param('id') id: string,
  ): Promise<RecordingUrlResponse> {
    return this.calls.recordingUrl(ctx.organization.id, id, ctx.user.id);
  }
}
