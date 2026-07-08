import { Body, Controller, Post } from '@nestjs/common';
import { MergeCustomersInput, PERMISSIONS, type MergeResult } from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { IdentityService } from './identity.service';

@Controller('customers')
export class CustomersController {
  constructor(private readonly identity: IdentityService) {}

  /** Manual admin merge of two customers (audited). */
  @Post('merge')
  @RequirePermission(PERMISSIONS.COMMERCE_MANAGE)
  async merge(
    @CurrentUser() ctx: UserContext,
    @Body(new ZodValidationPipe(MergeCustomersInput)) body: MergeCustomersInput,
  ): Promise<MergeResult> {
    return this.identity.merge(ctx.organization.id, body.survivorId, body.mergedId, ctx.user.id);
  }
}
