import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from './require-permission.decorator';
import type { AuthenticatedRequest } from '../auth/auth.types';

/**
 * Authorization guard. Runs after ClerkAuthGuard. If a route declares
 * @RequirePermission(...), the current user's role must grant ALL of them.
 * Routes without the decorator require only authentication.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const ctx = request.userContext;
    if (!ctx) {
      // Authn guard should have populated this; defensively deny.
      throw forbidden('Missing user context');
    }

    const granted = new Set(ctx.permissions);
    const missing = required.filter((p) => !granted.has(p));
    if (missing.length > 0) {
      throw forbidden(`Missing required permission(s): ${missing.join(', ')}`);
    }
    return true;
  }
}

/** A 403 carrying a stable machine `code: 'FORBIDDEN'` for clients to branch on. */
function forbidden(message: string): ForbiddenException {
  return new ForbiddenException({ statusCode: 403, code: 'FORBIDDEN', error: 'Forbidden', message });
}
