import { Body, Controller, Post } from '@nestjs/common';
import { PERMISSIONS, AssistantAskInput, type AssistantAnswer } from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AssistantService } from './assistant.service';

/**
 * The read-only AI assistant. One endpoint: ask a question, get a grounded
 * answer. @RequirePermission(AI_QUERY) gates access, and the answer inherits
 * the asker's FULL permission set (org scope + PII masking) via @CurrentUser —
 * a lower-privilege asker can never obtain data they couldn't otherwise see.
 * There is no mutation endpoint: the assistant cannot act.
 */
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Post('ask')
  @RequirePermission(PERMISSIONS.AI_QUERY)
  async ask(
    @CurrentUser() ctx: UserContext,
    @Body(new ZodValidationPipe(AssistantAskInput)) body: AssistantAskInput,
  ): Promise<AssistantAnswer> {
    return this.assistant.ask(ctx, body.question);
  }
}
