import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AuditService } from './audit.service';
import type { AuthenticatedRequest } from '../auth/auth.types';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const METHOD_TO_ACTION: Record<string, string> = {
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
};

/**
 * Writes an AuditLog entry after every successful mutating request. Read
 * requests are ignored. Failures never propagate to the client (see AuditService).
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!MUTATING_METHODS.has(request.method)) {
      return next.handle();
    }

    return next.handle().pipe(
      tap((responseBody) => {
        const ctx = request.userContext;
        if (!ctx) return; // only audit authenticated mutations

        void this.audit.record({
          organizationId: ctx.organization.id,
          actorUserId: ctx.user.id,
          actorClerkUserId: ctx.user.clerkUserId,
          action: METHOD_TO_ACTION[request.method] ?? request.method.toLowerCase(),
          entity: this.resolveEntity(request),
          after: responseBody ?? null,
          ip: request.ip ?? null,
          userAgent: request.headers['user-agent'] ?? null,
        });
      }),
    );
  }

  private resolveEntity(request: AuthenticatedRequest): string {
    // Prefer the route pattern (e.g. "/teams/:id") over the concrete URL.
    const route = (request as { route?: { path?: string } }).route;
    return route?.path ?? request.originalUrl ?? request.url;
  }
}
