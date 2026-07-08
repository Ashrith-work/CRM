import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ConnectIntegrationInput,
  PERMISSIONS,
  type Integration,
  type IntegrationListResponse,
} from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { IntegrationsService } from './integrations.service';

/**
 * Integrations (Configure). Read is granted to all roles; connect/disconnect
 * require integration:manage (members get 403 FORBIDDEN — the RBAC accept path).
 */
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get()
  @RequirePermission(PERMISSIONS.INTEGRATION_READ)
  async list(@CurrentUser() ctx: UserContext): Promise<IntegrationListResponse> {
    return { data: await this.integrations.list(ctx.organization.id) };
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.INTEGRATION_READ)
  async get(@CurrentUser() ctx: UserContext, @Param('id') id: string): Promise<Integration> {
    return this.integrations.get(ctx.organization.id, id);
  }

  @Post('connect')
  @RequirePermission(PERMISSIONS.INTEGRATION_MANAGE)
  async connect(
    @CurrentUser() ctx: UserContext,
    @Body(new ZodValidationPipe(ConnectIntegrationInput)) body: ConnectIntegrationInput,
  ): Promise<Integration> {
    return this.integrations.connect(ctx.organization.id, ctx.user.id, body);
  }

  @Post(':id/disconnect')
  @RequirePermission(PERMISSIONS.INTEGRATION_MANAGE)
  async disconnect(@CurrentUser() ctx: UserContext, @Param('id') id: string): Promise<Integration> {
    return this.integrations.disconnect(ctx.organization.id, id);
  }
}
