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

  await seedCrmSampleData(org.id, owner.id);
  await seedRevenueSampleData(org.id, owner.id);

  console.log('Seed complete:');
  console.log(`  org:    ${org.name} (${org.slug}) id=${org.id}`);
  console.log(`  team:   ${team.name}`);
  console.log(`  roles:  ${Object.keys(roleIdByName).join(', ')}`);
  console.log(`  owner:  ${owner.email} clerkUserId=${owner.clerkUserId}`);
  console.log(`  member: ${member.email} clerkUserId=${member.clerkUserId}`);
}

/**
 * Idempotent CRM sample data: a handful of companies/contacts/leads with tags,
 * custom-field definitions, a note, and activity — enough to demo every screen.
 * Skipped entirely if the org already has companies (so re-seeding is safe).
 *
 * Set SEED_BULK_CONTACTS=50000 to additionally bulk-insert contacts for the
 * list P95 perf test (createMany in batches; no tags/notes attached).
 */
async function seedCrmSampleData(organizationId: string, ownerId: string): Promise<void> {
  const existing = await prisma.company.count({ where: { organizationId } });
  if (existing === 0) {
    const [tagVip, tagPartner, tagCold] = await Promise.all([
      prisma.tag.create({ data: { organizationId, name: 'VIP', color: '#274fd6' } }),
      prisma.tag.create({ data: { organizationId, name: 'Partner', color: '#0ea5e9' } }),
      prisma.tag.create({ data: { organizationId, name: 'Cold', color: '#64748b' } }),
    ]);

    // Custom-field definitions across entities.
    await prisma.customFieldDefinition.createMany({
      data: [
        { organizationId, entityType: 'CONTACT', key: 'linkedin', label: 'LinkedIn', fieldType: 'TEXT', order: 0 },
        { organizationId, entityType: 'COMPANY', key: 'arr', label: 'ARR (USD)', fieldType: 'NUMBER', order: 0 },
        {
          organizationId,
          entityType: 'LEAD',
          key: 'priority',
          label: 'Priority',
          fieldType: 'SELECT',
          options: ['Low', 'Medium', 'High'],
          order: 0,
        },
      ],
    });

    const acme = await prisma.company.create({
      data: {
        organizationId,
        ownerId,
        name: 'Globex Corporation',
        domain: 'globex.com',
        industry: 'Manufacturing',
        size: '201-500',
        website: 'https://globex.com',
        phone: '+1-202-555-0100',
        customFields: { arr: 250000 },
      },
    });
    const initech = await prisma.company.create({
      data: {
        organizationId,
        ownerId,
        name: 'Initech',
        domain: 'initech.com',
        industry: 'Software',
        size: '51-200',
        customFields: { arr: 90000 },
      },
    });

    const jane = await prisma.contact.create({
      data: {
        organizationId,
        ownerId,
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane.doe@globex.com',
        phone: '+1-202-555-0111',
        jobTitle: 'VP Operations',
        companyId: acme.id,
        customFields: { linkedin: 'in/janedoe' },
      },
    });
    await prisma.contact.create({
      data: {
        organizationId,
        ownerId,
        firstName: 'Peter',
        lastName: 'Gibbons',
        email: 'peter@initech.com',
        jobTitle: 'Engineer',
        companyId: initech.id,
      },
    });

    await prisma.taggable.createMany({
      data: [
        { organizationId, tagId: tagVip.id, entityType: 'COMPANY', entityId: acme.id },
        { organizationId, tagId: tagPartner.id, entityType: 'COMPANY', entityId: initech.id },
        { organizationId, tagId: tagVip.id, entityType: 'CONTACT', entityId: jane.id },
      ],
    });

    await prisma.lead.createMany({
      data: [
        { organizationId, ownerId, firstName: 'Sara', lastName: 'Lang', email: 'sara.lang@example.com', source: 'Website', status: 'NEW', customFields: { priority: 'High' } },
        { organizationId, ownerId, firstName: 'Omar', lastName: 'Reyes', email: 'omar.reyes@example.com', source: 'Referral', status: 'CONTACTED' },
        { organizationId, ownerId, firstName: 'Lin', lastName: 'Wu', email: 'lin.wu@example.com', source: 'Event', status: 'QUALIFIED', customFields: { priority: 'Medium' } },
      ],
    });

    await prisma.note.create({
      data: { organizationId, entityType: 'CONTACT', entityId: jane.id, authorId: ownerId, body: 'Intro call went well — wants a follow-up next week.' },
    });
    await prisma.activityEvent.createMany({
      data: [
        { organizationId, entityType: 'COMPANY', entityId: acme.id, actorId: ownerId, eventType: 'CREATED', source: 'seed' },
        { organizationId, entityType: 'CONTACT', entityId: jane.id, actorId: ownerId, eventType: 'CREATED', source: 'seed' },
        { organizationId, entityType: 'CONTACT', entityId: jane.id, actorId: ownerId, eventType: 'NOTE_ADDED', source: 'seed' },
      ],
    });
    console.log('  crm:    seeded sample companies/contacts/leads/tags/custom-fields');
  } else {
    console.log('  crm:    sample data already present — skipped');
  }

  const bulk = Number(process.env.SEED_BULK_CONTACTS ?? 0);
  if (bulk > 0) {
    const already = await prisma.contact.count({ where: { organizationId, ownerId, firstName: 'Bulk' } });
    const toCreate = bulk - already;
    if (toCreate > 0) {
      console.log(`  crm:    bulk-inserting ${toCreate} contacts for perf testing…`);
      const BATCH = 5000;
      for (let start = already; start < bulk; start += BATCH) {
        const rows = [];
        const end = Math.min(start + BATCH, bulk);
        for (let i = start; i < end; i++) {
          rows.push({
            organizationId,
            ownerId,
            firstName: 'Bulk',
            lastName: `Contact${i}`,
            email: `bulk.contact${i}@example.com`,
          });
        }
        await prisma.contact.createMany({ data: rows });
      }
      console.log(`  crm:    bulk contacts total = ${bulk}`);
    }
  }
}

/**
 * Milestone 2 sample data: a default "Sales Pipeline" with five stages and a
 * couple of deals linked to the existing sample contact/company. Idempotent —
 * skipped if the org already has a pipeline.
 */
async function seedRevenueSampleData(organizationId: string, ownerId: string): Promise<void> {
  const existing = await prisma.pipeline.count({ where: { organizationId } });
  if (existing > 0) {
    console.log('  deals:  pipeline already present — skipped');
    return;
  }

  const pipeline = await prisma.pipeline.create({
    data: { organizationId, name: 'Sales Pipeline', isDefault: true, position: 0 },
  });

  const stageData: Array<{ name: string; position: number; probability: number; type: 'OPEN' | 'WON' | 'LOST' }> = [
    { name: 'New', position: 0, probability: 10, type: 'OPEN' },
    { name: 'Qualified', position: 1, probability: 30, type: 'OPEN' },
    { name: 'Proposal', position: 2, probability: 60, type: 'OPEN' },
    { name: 'Won', position: 3, probability: 100, type: 'WON' },
    { name: 'Lost', position: 4, probability: 0, type: 'LOST' },
  ];
  const stages: Record<string, string> = {};
  for (const s of stageData) {
    const stage = await prisma.stage.create({
      data: { organizationId, pipelineId: pipeline.id, name: s.name, position: s.position, probability: s.probability, type: s.type },
    });
    stages[s.name] = stage.id;
  }

  const company = await prisma.company.findFirst({ where: { organizationId, deletedAt: null } });
  const contact = await prisma.contact.findFirst({ where: { organizationId, deletedAt: null } });

  const deals: Array<{ name: string; stage: string; amountMinor: number; contactId?: string; companyId?: string }> = [
    { name: 'Globex — Platform license', stage: 'Qualified', amountMinor: 4_500_000, companyId: company?.id, contactId: contact?.id },
    { name: 'Initech — Pilot', stage: 'New', amountMinor: 1_200_000, companyId: company?.id },
    { name: 'Proposal in flight', stage: 'Proposal', amountMinor: 8_000_000 },
  ];
  for (const d of deals) {
    const deal = await prisma.deal.create({
      data: {
        organizationId,
        ownerId,
        name: d.name,
        pipelineId: pipeline.id,
        stageId: stages[d.stage],
        amountMinor: d.amountMinor,
        currency: 'USD',
        contactId: d.contactId ?? null,
        companyId: d.companyId ?? null,
      },
    });
    await prisma.activityEvent.create({
      data: { organizationId, entityType: 'DEAL', entityId: deal.id, actorId: ownerId, eventType: 'CREATED', source: 'seed' },
    });
  }

  console.log(`  deals:  seeded "${pipeline.name}" with ${stageData.length} stages + ${deals.length} deals`);
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
