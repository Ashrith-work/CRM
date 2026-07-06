import { NotFoundException } from '@nestjs/common';
import type { EntityType } from '@crm/types';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Asserts an entity id exists in the org and is not soft-deleted. Used before
 * attaching notes/tags/activity so those never dangle on an invalid target.
 */
export async function assertEntityInOrg(
  prisma: PrismaService,
  organizationId: string,
  entityType: EntityType,
  entityId: string,
): Promise<void> {
  const where = { id: entityId, organizationId, deletedAt: null };
  const select = { id: true };
  const found =
    entityType === 'CONTACT'
      ? await prisma.contact.findFirst({ where, select })
      : entityType === 'COMPANY'
        ? await prisma.company.findFirst({ where, select })
        : await prisma.lead.findFirst({ where, select });

  if (!found) throw new NotFoundException(`${entityType} not found`);
}
