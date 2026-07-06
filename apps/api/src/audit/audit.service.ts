import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  organizationId: string;
  actorUserId?: string | null;
  actorClerkUserId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          organizationId: entry.organizationId,
          actorUserId: entry.actorUserId ?? null,
          actorClerkUserId: entry.actorClerkUserId ?? null,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId ?? null,
          before: (entry.before ?? undefined) as never,
          after: (entry.after ?? undefined) as never,
          ip: entry.ip ?? null,
          userAgent: entry.userAgent ?? null,
        },
      });
    } catch (err) {
      // Audit must never break the request path.
      this.logger.error(`Failed to write audit log: ${(err as Error).message}`);
    }
  }
}
