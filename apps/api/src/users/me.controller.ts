import { Body, Controller, Get, Patch } from '@nestjs/common';
import { PERMISSIONS, UpdateTimezoneInput, type MeResponse } from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { UsersService } from './users.service';

@Controller('me')
export class MeController {
  constructor(private readonly users: UsersService) {}

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

  /** Set the current user's IANA timezone (used for reminders + agenda). */
  @Patch('timezone')
  @RequirePermission(PERMISSIONS.USER_READ)
  async setTimezone(
    @CurrentUser() ctx: UserContext,
    @Body(new ZodValidationPipe(UpdateTimezoneInput)) body: UpdateTimezoneInput,
  ): Promise<{ timezone: string }> {
    return { timezone: await this.users.setTimezone(ctx.user.id, body.timezone) };
  }
}
