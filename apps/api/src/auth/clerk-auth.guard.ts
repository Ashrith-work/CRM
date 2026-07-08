import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ClerkService, TokenVerificationFailure } from './clerk.service';
import { UserContextService } from './user-context.service';
import type { AuthenticatedRequest } from './auth.types';

/**
 * Authentication guard:
 *  1. Skips @Public() routes.
 *  2. Verifies the Clerk bearer token and extracts userId + orgId.
 *  3. Resolves the DB-backed UserContext and attaches it to the request.
 *
 * Invalid/expired/missing token → 401. Authenticated but not provisioned in an
 * organization → 403.
 */
@Injectable()
export class ClerkAuthGuard implements CanActivate {
  private readonly logger = new Logger(ClerkAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly clerk: ClerkService,
    private readonly userContext: UserContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractToken(request);
    if (!token) {
      // Precise reason in logs; generic message to the client.
      this.logger.warn(`401 missing: no bearer token on ${request.method} ${request.url}`);
      throw new UnauthorizedException('Missing bearer token');
    }

    let claims;
    try {
      claims = await this.clerk.verifyToken(token);
    } catch (err) {
      const reason = err instanceof TokenVerificationFailure ? err.reason : 'invalid';
      this.logger.warn(`401 ${reason}: ${(err as Error).message} on ${request.method} ${request.url}`);
      // A 401 tells the client to refresh the token (getToken skipCache) + retry.
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (!claims?.sub) {
      this.logger.warn(`401 invalid: token has no sub claim on ${request.method} ${request.url}`);
      throw new UnauthorizedException('Invalid token claims');
    }

    request.auth = {
      clerkUserId: claims.sub,
      clerkOrgId: claims.org_id ?? null,
      sessionId: claims.sid,
    };

    const resolved = await this.userContext.resolve(claims.sub, claims.org_id ?? null);
    if (!resolved) {
      throw new ForbiddenException('User is not provisioned in an organization');
    }
    request.userContext = resolved;

    return true;
  }

  private extractToken(request: AuthenticatedRequest): string | null {
    const header = request.headers['authorization'];
    if (!header) return null;
    const [scheme, value] = header.split(' ');
    return scheme === 'Bearer' && value ? value : null;
  }
}
