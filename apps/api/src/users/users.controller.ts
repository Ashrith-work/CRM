import { Controller, Get } from '@nestjs/common';
import { PERMISSIONS, type OrgUserListResponse } from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** Org user directory for the assignee picker. USER_READ is held by every role. */
  @Get()
  @RequirePermission(PERMISSIONS.USER_READ)
  async list(@CurrentUser() ctx: UserContext): Promise<OrgUserListResponse> {
    return { data: await this.users.list(ctx.organization.id) };
  }
}
