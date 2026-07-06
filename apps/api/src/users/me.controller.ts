import { Controller, Get } from '@nestjs/common';
import { PERMISSIONS, type MeResponse } from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';

@Controller('me')
export class MeController {
  /**
   * Returns the current user + org + team + role. Requires authentication and
   * the user:read permission (granted to every system role, so any provisioned
   * user gets 200; anonymous requests get 401 from the auth guard).
   */
  @Get()
  @RequirePermission(PERMISSIONS.USER_READ)
  me(@CurrentUser() ctx: UserContext): MeResponse {
    return {
      user: ctx.user,
      organization: ctx.organization,
      team: ctx.team,
      role: ctx.role,
    };
  }
}
