import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  ConnectIntegrationInput,
  Integration as IntegrationDto,
} from '@crm/types';
import { Prisma, type Integration as IntegrationRow } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Third-party integrations directory (Configure). Read-only config storage —
 * secrets stay in env. connect() upserts on (org, provider); disconnect() flips
 * status. Every mutation is audited by the global AuditInterceptor.
 */
@Injectable()
export class IntegrationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string): Promise<IntegrationDto[]> {
    const rows = await this.prisma.integration.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { provider: 'asc' },
    });
    return rows.map(serializeIntegration);
  }

  async get(organizationId: string, id: string): Promise<IntegrationDto> {
    const row = await this.prisma.integration.findFirst({ where: { id, organizationId, deletedAt: null } });
    if (!row) throw new NotFoundException('Integration not found');
    return serializeIntegration(row);
  }

  async connect(organizationId: string, actorId: string, input: ConnectIntegrationInput): Promise<IntegrationDto> {
    const row = await this.prisma.integration.upsert({
      where: { organizationId_provider: { organizationId, provider: input.provider } },
      update: {
        status: 'CONNECTED',
        externalAccountId: input.externalAccountId ?? null,
        config: (input.config ?? {}) as Prisma.InputJsonValue,
        connectedById: actorId,
        connectedAt: new Date(),
        deletedAt: null,
      },
      create: {
        organizationId,
        provider: input.provider,
        status: 'CONNECTED',
        externalAccountId: input.externalAccountId ?? null,
        config: (input.config ?? {}) as Prisma.InputJsonValue,
        connectedById: actorId,
        connectedAt: new Date(),
      },
    });
    return serializeIntegration(row);
  }

  async disconnect(organizationId: string, id: string): Promise<IntegrationDto> {
    await this.get(organizationId, id);
    const row = await this.prisma.integration.update({
      where: { id },
      data: { status: 'DISCONNECTED', connectedAt: null },
    });
    return serializeIntegration(row);
  }
}

export function serializeIntegration(row: IntegrationRow): IntegrationDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    provider: row.provider,
    status: row.status,
    externalAccountId: row.externalAccountId,
    config: (row.config as Record<string, unknown>) ?? {},
    connectedById: row.connectedById,
    connectedAt: row.connectedAt ? row.connectedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
