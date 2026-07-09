import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PERMISSIONS, RedeemPointsInput, type LoyaltyBalanceResponse, type LoyaltyLedgerResponse } from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { LoyaltyService } from './loyalty.service';

/**
 * Loyalty ledger reads + redemption. Balance is always the ledger SUM. Redeeming
 * (burning points) is LOYALTY_MANAGE; viewing is LOYALTY_READ.
 */
@Controller('loyalty')
export class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get(':customerId/balance')
  @RequirePermission(PERMISSIONS.LOYALTY_READ)
  async balance(@CurrentUser() ctx: UserContext, @Param('customerId') customerId: string): Promise<LoyaltyBalanceResponse> {
    return this.loyalty.balance(ctx.organization.id, customerId);
  }

  @Get(':customerId/ledger')
  @RequirePermission(PERMISSIONS.LOYALTY_READ)
  async ledger(
    @CurrentUser() ctx: UserContext,
    @Param('customerId') customerId: string,
    @Query('limit') limit?: string,
  ): Promise<LoyaltyLedgerResponse> {
    return this.loyalty.ledger(ctx.organization.id, customerId, Number(limit) || 100);
  }

  @Post(':customerId/redeem')
  @RequirePermission(PERMISSIONS.LOYALTY_MANAGE)
  async redeem(
    @CurrentUser() ctx: UserContext,
    @Param('customerId') customerId: string,
    @Body(new ZodValidationPipe(RedeemPointsInput)) body: RedeemPointsInput,
  ): Promise<LoyaltyBalanceResponse> {
    return this.loyalty.redeem(ctx.organization.id, customerId, body.points, body.note);
  }
}
