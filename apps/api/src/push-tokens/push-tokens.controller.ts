import { Body, Controller, Delete, HttpCode, Post } from '@nestjs/common';
import {
  PERMISSIONS,
  RegisterPushTokenInput,
  UnregisterPushTokenInput,
  type PushToken,
} from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PushTokensService } from './push-tokens.service';

/** Device push-token lifecycle. Any authenticated user (USER_READ) manages
 * their own device tokens. */
@Controller('push-tokens')
export class PushTokensController {
  constructor(private readonly pushTokens: PushTokensService) {}

  @Post()
  @RequirePermission(PERMISSIONS.USER_READ)
  async register(
    @CurrentUser() ctx: UserContext,
    @Body(new ZodValidationPipe(RegisterPushTokenInput)) body: RegisterPushTokenInput,
  ): Promise<PushToken> {
    return this.pushTokens.register(ctx.organization.id, ctx.user.id, body.token, body.platform);
  }

  @Delete()
  @RequirePermission(PERMISSIONS.USER_READ)
  @HttpCode(204)
  async unregister(
    @CurrentUser() ctx: UserContext,
    @Body(new ZodValidationPipe(UnregisterPushTokenInput)) body: UnregisterPushTokenInput,
  ): Promise<void> {
    await this.pushTokens.unregister(ctx.user.id, body.token);
  }
}
