import type { Actor } from '@crm/types';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Resolves User.id references (ownerId / authorId / actorId are stored as plain
 * scalars, not FKs) into lightweight Actor objects for display. Always scoped by
 * organizationId to uphold tenant isolation.
 */
export async function resolveActors(
  prisma: PrismaService,
  organizationId: string,
  ids: Array<string | null | undefined>,
): Promise<Map<string, Actor>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();

  const users = await prisma.user.findMany({
    where: { organizationId, id: { in: unique } },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  return new Map(users.map((u) => [u.id, u]));
}
