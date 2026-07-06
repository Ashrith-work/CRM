import { Injectable, Logger } from '@nestjs/common';
import type {
  ActivityEvent as ActivityEventDto,
  ActivityEventType,
  EntityType,
  FeedQueryInput,
} from '@crm/types';
import type { ActivityEvent as ActivityEventRow, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { resolveActors } from '../common/actors.util';
import { toPage } from '../common/list.util';

export interface EmitActivityInput {
  organizationId: string;
  entityType: EntityType;
  entityId: string;
  eventType: ActivityEventType;
  actorId?: string | null;
  metadata?: Prisma.InputJsonValue;
  /** e.g. "web", "mobile", "api", "seed". */
  source?: string | null;
}

/**
 * The shared timeline emitter. EVERY mutation across the CRM modules calls
 * emit(...) so the user-facing activity feed is complete. Distinct from the
 * infra AuditLog (written automatically by the AuditInterceptor).
 */
@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(private readonly prisma: PrismaService) {}

  async emit(input: EmitActivityInput): Promise<void> {
    try {
      await this.prisma.activityEvent.create({
        data: {
          organizationId: input.organizationId,
          entityType: input.entityType,
          entityId: input.entityId,
          eventType: input.eventType,
          actorId: input.actorId ?? null,
          metadata: input.metadata ?? undefined,
          source: input.source ?? null,
        },
      });
    } catch (err) {
      // Never let timeline writes break the request path.
      this.logger.error(`Failed to emit ${input.eventType} activity: ${(err as Error).message}`);
    }
  }

  /** Entity-scoped feed, newest-first, cursor-paginated. */
  async list(
    organizationId: string,
    query: FeedQueryInput,
  ): Promise<{ data: ActivityEventDto[]; nextCursor: string | null }> {
    const rows = await this.prisma.activityEvent.findMany({
      where: { organizationId, entityType: query.entityType, entityId: query.entityId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const page = toPage(rows, query.limit);
    const actors = await resolveActors(this.prisma, organizationId, page.data.map((r) => r.actorId));
    return {
      data: page.data.map((r) => this.serialize(r, actors)),
      nextCursor: page.nextCursor,
    };
  }

  private serialize(
    row: ActivityEventRow,
    actors: Map<string, { id: string; firstName: string | null; lastName: string | null; email: string }>,
  ): ActivityEventDto {
    return {
      id: row.id,
      organizationId: row.organizationId,
      entityType: row.entityType,
      entityId: row.entityId,
      actorId: row.actorId,
      actor: row.actorId ? (actors.get(row.actorId) ?? null) : null,
      eventType: row.eventType,
      metadata: (row.metadata ?? null) as unknown,
      source: row.source,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
