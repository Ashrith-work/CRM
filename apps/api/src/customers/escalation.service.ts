import { Injectable, NotFoundException } from '@nestjs/common';
import type { AddEscalationInput, EscalationSummaryDto } from '@crm/types';
import type { EscalationSummary as EscalationRow } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { scrubPii } from '../assistant/scrub-pii.util';

/**
 * Purchase Analysis escalations — the one NEW dataset (Shopify has none). Each
 * add creates the row, emits an Interaction onto the customer timeline (summary
 * PII-scrubbed, since interactions can feed the AI-safe surface), and writes an
 * AuditLog. The raw note is kept for the RBAC-gated panel; it is scrubbed before
 * any AI use. authorUserId is a soft scalar ref to User.id.
 */
@Injectable()
export class EscalationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async add(
    organizationId: string,
    customerId: string,
    input: AddEscalationInput,
    actorUserId: string,
  ): Promise<EscalationSummaryDto> {
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, organizationId, deletedAt: null } });
    if (!customer) throw new NotFoundException('Customer not found');

    const row = await this.prisma.escalationSummary.create({
      data: {
        organizationId,
        customerId,
        orderId: input.orderId ?? null,
        note: input.note,
        status: input.status ?? null,
        authorUserId: actorUserId,
      },
    });

    // Timeline: a TICKET interaction with a PII-scrubbed summary (raw note stays
    // in the RBAC-gated escalation panel only).
    const snippet = scrubPii(input.note).slice(0, 140);
    await this.prisma.interaction.create({
      data: {
        organizationId,
        customerId,
        type: 'TICKET',
        refId: row.id,
        summary: `Escalation${input.status ? ` [${input.status}]` : ''}: ${snippet}`,
        occurredAt: row.createdAt,
      },
    });

    await this.audit.record({
      organizationId,
      actorUserId,
      action: 'escalation.create',
      entity: 'EscalationSummary',
      entityId: row.id,
      after: { customerId, orderId: row.orderId, status: row.status },
    });

    const authorName = await this.authorName(organizationId, actorUserId);
    return toDto(row, authorName);
  }

  async list(organizationId: string, customerId: string): Promise<EscalationSummaryDto[]> {
    const rows = await this.prisma.escalationSummary.findMany({
      where: { organizationId, customerId },
      orderBy: { createdAt: 'desc' },
    });
    const authorIds = [...new Set(rows.map((r) => r.authorUserId))];
    const users = authorIds.length
      ? await this.prisma.user.findMany({ where: { organizationId, id: { in: authorIds } }, select: { id: true, firstName: true, lastName: true, email: true } })
      : [];
    const nameById = new Map(
      users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email]),
    );
    return rows.map((r) => toDto(r, nameById.get(r.authorUserId) ?? null));
  }

  private async authorName(organizationId: string, userId: string): Promise<string | null> {
    const u = await this.prisma.user.findFirst({ where: { id: userId, organizationId }, select: { firstName: true, lastName: true, email: true } });
    if (!u) return null;
    return [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email;
  }
}

function toDto(r: EscalationRow, authorName: string | null): EscalationSummaryDto {
  return {
    id: r.id,
    customerId: r.customerId,
    orderId: r.orderId,
    note: r.note,
    status: r.status,
    authorUserId: r.authorUserId,
    authorName,
    createdAt: r.createdAt.toISOString(),
  };
}
