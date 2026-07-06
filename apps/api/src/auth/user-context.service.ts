import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { UserContext } from './auth.types';

/**
 * Resolves the DB-backed application context for an authenticated Clerk user.
 * Returns null when the user is unknown or has no role (i.e. not provisioned
 * into an organization) — the guard maps that to 403.
 *
 * Every lookup is scoped by the user's own organizationId, upholding the
 * tenant-isolation invariant.
 */
@Injectable()
export class UserContextService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(clerkUserId: string, _clerkOrgId: string | null): Promise<UserContext | null> {
    const user = await this.prisma.user.findUnique({
      where: { clerkUserId },
      include: {
        organization: true,
        userRoles: { include: { role: { include: { permissions: true } } } },
        teamMemberships: { include: { team: true }, take: 1 },
      },
    });

    if (!user) return null;

    const primaryRole = user.userRoles[0]?.role;
    if (!primaryRole) return null; // authenticated but not provisioned

    const team = user.teamMemberships[0]?.team ?? null;

    return {
      user: {
        id: user.id,
        clerkUserId: user.clerkUserId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      organization: {
        id: user.organization.id,
        name: user.organization.name,
        slug: user.organization.slug,
      },
      team: team ? { id: team.id, name: team.name } : null,
      role: {
        id: primaryRole.id,
        name: primaryRole.name,
        permissions: primaryRole.permissions.map((p) => p.key),
      },
      permissions: primaryRole.permissions.map((p) => p.key),
    };
  }
}
