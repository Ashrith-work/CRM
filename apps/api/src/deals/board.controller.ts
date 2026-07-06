import { Controller, Get, Param } from '@nestjs/common';
import { PERMISSIONS, type BoardResponse } from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { DealsService } from './deals.service';

/**
 * Board route lives under the pipelines path per the API contract
 * (GET /api/v1/pipelines/:id/board) but is served by DealsService. Kept in the
 * deals module to avoid a circular dependency with PipelinesModule.
 */
@Controller('pipelines')
export class BoardController {
  constructor(private readonly deals: DealsService) {}

  @Get(':id/board')
  @RequirePermission(PERMISSIONS.DEAL_READ)
  async board(@CurrentUser() ctx: UserContext, @Param('id') id: string): Promise<BoardResponse> {
    return this.deals.board(ctx.organization.id, id);
  }
}
