import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest, UserContext } from './auth.types';

/** Injects the resolved UserContext (set by ClerkAuthGuard) into a handler. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): UserContext | undefined => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.userContext;
  },
);
