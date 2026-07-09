import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  PERMISSIONS,
  EvaluateIncentiveInput,
  type IncentiveConfigResponse,
  type IncentiveListResponse,
} from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { IncentiveService } from './incentive.service';

@Controller('incentives')
export class IncentiveController {
  constructor(private readonly incentives: IncentiveService) {}

  @Get()
  @RequirePermission(PERMISSIONS.INCENTIVE_READ)
  async list(@CurrentUser() ctx: UserContext, @Query('customerId') customerId?: string): Promise<IncentiveListResponse> {
    return { data: await this.incentives.list(ctx.organization.id, customerId) };
  }

  /** The current engine config incl. the HONEST margin-guard state. */
  @Get('config')
  @RequirePermission(PERMISSIONS.INCENTIVE_READ)
  config(): IncentiveConfigResponse {
    return this.incentives.configResponse();
  }

  /** Re-evaluate a customer for a threshold incentive now (admin/testing). */
  @Post('evaluate')
  @RequirePermission(PERMISSIONS.INCENTIVE_MANAGE)
  async evaluate(
    @CurrentUser() ctx: UserContext,
    @Body(new ZodValidationPipe(EvaluateIncentiveInput)) body: EvaluateIncentiveInput,
  ): Promise<{ issued: boolean }> {
    const issued = await this.incentives.evaluateForOrder(ctx.organization.id, { externalId: 'manual', customerId: body.customerId, status: 'PAID', discountCode: null });
    return { issued: !!issued };
  }
}
