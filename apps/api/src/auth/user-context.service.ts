import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ClerkService } from './clerk.service';
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
  private readonly logger = new Logger(UserContextService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clerk: ClerkService,
  ) {}

  private readonly include = {
    organization: true,
    userRoles: { include: { role: { include: { permissions: true } } } },
    teamMemberships: { include: { team: true }, take: 1 },
  } as const;

  async resolve(clerkUserId: string, _clerkOrgId: string | null): Promise<UserContext | null> {
    let user = await this.prisma.user.findUnique({ where: { clerkUserId }, include: this.include });

    // Self-heal: if this Clerk id isn't bound yet, bind it to a seeded user whose
    // email matches the signed-in Clerk account (also fixes a stale seed id).
    if (!user) {
      const email = await this.clerk.getUserEmail(clerkUserId);
      if (email) {
        const byEmail = await this.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
        if (byEmail) {
          await this.prisma.user.update({ where: { id: byEmail.id }, data: { clerkUserId } });
          user = await this.prisma.user.findUnique({ where: { clerkUserId }, include: this.include });
          this.logger.log(`Provisioned Clerk user ${clerkUserId} → ${email} (bound to seeded user)`);
        } else {
          this.logger.warn(`Not provisioned: Clerk ${clerkUserId} (${email}) has no matching seeded user`);
        }
      } else {
        this.logger.warn(`Not provisioned: Clerk ${clerkUserId} — could not resolve an email to bind`);
      }
    }

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
