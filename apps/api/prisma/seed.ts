import { PrismaClient } from '@prisma/client';
import {
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
  SYSTEM_ROLES,
  type SystemRoleName,
} from '@crm/types';

const prisma = new PrismaClient();

/**
 * Idempotent seed: an organization with its permission catalog, the three
 * system roles, a team, and two users:
 *   - owner  → full permissions (proves 200 on protected routes)
 *   - member → read-only        (proves 403 on privileged routes)
 *
 * To bind the seed to YOUR Clerk identity, set SEED_CLERK_ORG_ID / SEED_CLERK_USER_ID
 * in apps/api/.env before running. Otherwise deterministic placeholders are used.
 */
async function main() {
  const clerkOrgId = process.env.SEED_CLERK_ORG_ID || 'org_seed_placeholder';
  const clerkUserId = process.env.SEED_CLERK_USER_ID || 'user_seed_owner';
  const ownerEmail = process.env.SEED_USER_EMAIL || 'owner@example.com';

  const org = await prisma.organization.upsert({
    where: { slug: 'acme' },
    update: { clerkOrgId },
    create: { name: 'Acme Inc', slug: 'acme', clerkOrgId },
  });

  // Permission catalog (org-scoped).
  for (const key of ALL_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { organizationId_key: { organizationId: org.id, key } },
      update: {},
      create: { organizationId: org.id, key, description: key },
    });
  }
  const permissions = await prisma.permission.findMany({
    where: { organizationId: org.id },
  });
  const permByKey = new Map(permissions.map((p) => [p.key, p]));

  // System roles with their permission grants.
  const roleIdByName: Record<string, string> = {};
  for (const roleName of Object.values(SYSTEM_ROLES)) {
    const grants = ROLE_PERMISSIONS[roleName as SystemRoleName];
    const role = await prisma.role.upsert({
      where: { organizationId_name: { organizationId: org.id, name: roleName } },
      update: {
        isSystem: true,
        permissions: { set: grants.map((k) => ({ id: permByKey.get(k)!.id })) },
      },
      create: {
        organizationId: org.id,
        name: roleName,
        description: `${roleName} (system role)`,
        isSystem: true,
        permissions: { connect: grants.map((k) => ({ id: permByKey.get(k)!.id })) },
      },
    });
    roleIdByName[roleName] = role.id;
  }

  const team = await prisma.team.upsert({
    where: { organizationId_name: { organizationId: org.id, name: 'Core Team' } },
    update: {},
    create: { organizationId: org.id, name: 'Core Team' },
  });

  // Owner user.
  const owner = await prisma.user.upsert({
    where: { clerkUserId },
    update: { organizationId: org.id, email: ownerEmail },
    create: {
      organizationId: org.id,
      clerkUserId,
      email: ownerEmail,
      firstName: 'Ada',
      lastName: 'Owner',
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: owner.id, roleId: roleIdByName[SYSTEM_ROLES.OWNER] } },
    update: {},
    create: {
      organizationId: org.id,
      userId: owner.id,
      roleId: roleIdByName[SYSTEM_ROLES.OWNER],
    },
  });
  await prisma.teamMembership.upsert({
    where: { userId_teamId: { userId: owner.id, teamId: team.id } },
    update: {},
    create: { organizationId: org.id, userId: owner.id, teamId: team.id },
  });

  // Member user (read-only) to demonstrate the 403 path.
  const member = await prisma.user.upsert({
    where: { clerkUserId: 'user_seed_member' },
    update: { organizationId: org.id },
    create: {
      organizationId: org.id,
      clerkUserId: 'user_seed_member',
      email: 'member@example.com',
      firstName: 'Ben',
      lastName: 'Member',
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: member.id, roleId: roleIdByName[SYSTEM_ROLES.MEMBER] } },
    update: {},
    create: {
      organizationId: org.id,
      userId: member.id,
      roleId: roleIdByName[SYSTEM_ROLES.MEMBER],
    },
  });
  await prisma.teamMembership.upsert({
    where: { userId_teamId: { userId: member.id, teamId: team.id } },
    update: {},
    create: { organizationId: org.id, userId: member.id, teamId: team.id },
  });

  console.log('Seed complete:');
  console.log(`  org:    ${org.name} (${org.slug}) id=${org.id}`);
  console.log(`  team:   ${team.name}`);
  console.log(`  roles:  ${Object.keys(roleIdByName).join(', ')}`);
  console.log(`  owner:  ${owner.email} clerkUserId=${owner.clerkUserId}`);
  console.log(`  member: ${member.email} clerkUserId=${member.clerkUserId}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
