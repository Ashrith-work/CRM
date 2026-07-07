/* eslint-disable no-console */
import { PrismaClient, type Prisma } from '@prisma/client';
import { fakerEN_IN as faker } from '@faker-js/faker';
import {
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
  SYSTEM_ROLES,
  type SystemRoleName,
} from '@crm/types';

/**
 * Local-only demo seed: fills the database with coherent, realistic fake CRM
 * data so every list, timeline, and dashboard (M0–M4) has believable content on
 * both clients. Uses @faker-js/faker with a FIXED seed for reproducibility.
 *
 * SAFETY: refuses to run outside a local/dev database (see assertLocalDb).
 * RE-RUN: clears the seeded tables (children first) then re-inserts.
 *
 * Modes (env SEED_MODE): "small" (default) or "large". Money is INTEGER paise
 * (INR minor units). Timestamps are explicit UTC spread across the last ~10
 * months so trends and month-over-month comparisons are meaningful.
 */

// ---------------------------------------------------------------------------
// Config — counts per mode. Small = fast local demo; large = perf/scale.
// ---------------------------------------------------------------------------
const MODE = (process.env.SEED_MODE ?? 'small').toLowerCase() === 'large' ? 'large' : 'small';

const COUNTS = {
  small: { companies: 50, contacts: 300, leads: 100, deals: 200, tasks: 500, tags: 12 },
  large: { companies: 2_000, contacts: 50_000, leads: 500, deals: 10_000, tasks: 3_000, tags: 12 },
}[MODE];

const FAKER_SEED = 20260707; // fixed → reproducible dataset
const MONTHS_BACK = 10; // spread history across the last ~10 months
const BATCH = 5_000; // createMany chunk size

const prisma = new PrismaClient();
const NOW = new Date();
const HISTORY_START = new Date(NOW.getTime() - MONTHS_BACK * 30 * 86_400_000);

// ---------------------------------------------------------------------------
// Safety — never touch a non-local database.
// ---------------------------------------------------------------------------
function assertLocalDb(): void {
  if (process.env.NODE_ENV === 'production') {
    console.error('✋ Refusing to seed: NODE_ENV=production.');
    process.exit(1);
  }
  const url = process.env.DATABASE_URL ?? '';
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    console.error('✋ Refusing to seed: DATABASE_URL is missing or unparseable.');
    process.exit(1);
  }
  const localHosts = ['localhost', '127.0.0.1', '::1', 'host.docker.internal', 'postgres', 'db'];
  const looksLocal = localHosts.includes(host) || /(^|[.-])(dev|local)([.-]|$)/i.test(host);
  if (!looksLocal) {
    console.error(`✋ Refusing to seed: DATABASE_URL host "${host}" is not a local/dev host.`);
    console.error('   This demo seed WIPES tables and is for local testing only.');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Small deterministic helpers.
// ---------------------------------------------------------------------------
const counters: Record<string, number> = {};
const mkId = (prefix: string): string => `${prefix}_${(counters[prefix] = (counters[prefix] ?? 0) + 1)}`;
const pick = <T>(arr: readonly T[]): T => faker.helpers.arrayElement(arr as T[]);
const maybe = (probability: number): boolean => faker.datatype.boolean({ probability });
const between = (from: Date, to: Date): Date =>
  from >= to ? new Date(from) : faker.date.between({ from, to });
const rupeesToPaise = (rupees: number): number => rupees * 100;

async function chunkCreate<T>(create: (rows: T[]) => Promise<unknown>, rows: T[]): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    await create(rows.slice(i, i + BATCH));
  }
}

const INDUSTRIES = ['Software', 'Manufacturing', 'Fintech', 'Healthcare', 'Retail', 'Logistics', 'Education', 'Real Estate', 'Media', 'Energy'];
const SIZES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'];
const LEAD_SOURCES = ['google', 'meta', 'referral', 'organic'];
const TAG_NAMES = ['VIP', 'Partner', 'Cold', 'Hot', 'Enterprise', 'SMB', 'Renewal', 'Champion', 'Blocker', 'Referral', 'Inbound', 'Outbound'];
const TASK_TYPES = ['TASK', 'FOLLOW_UP', 'MEETING', 'CALL'] as const;
const TASK_OUTCOMES = ['Left voicemail', 'Scheduled follow-up', 'Sent proposal', 'Not interested', 'Requested demo', 'Closed the loop', 'Escalated to manager'];

const summary: Record<string, number> = {};
const bump = (k: string, n: number): void => {
  summary[k] = (summary[k] ?? 0) + n;
};

// ---------------------------------------------------------------------------
// RBAC bootstrap (permission catalog + system roles + a team) per org.
// ---------------------------------------------------------------------------
async function bootstrapOrg(name: string, slug: string, clerkOrgId?: string) {
  const org = await prisma.organization.create({
    data: { id: mkId('org'), name, slug, clerkOrgId: clerkOrgId || null },
  });
  bump('organizations', 1);

  await prisma.permission.createMany({
    data: ALL_PERMISSIONS.map((key) => ({ id: mkId('perm'), organizationId: org.id, key, description: key })),
  });
  const perms = await prisma.permission.findMany({ where: { organizationId: org.id }, select: { id: true, key: true } });
  const permId = new Map(perms.map((p) => [p.key, p.id]));
  bump('permissions', perms.length);

  const roleIdByName: Record<string, string> = {};
  for (const roleName of Object.values(SYSTEM_ROLES)) {
    const grants = ROLE_PERMISSIONS[roleName as SystemRoleName];
    const role = await prisma.role.create({
      data: {
        id: mkId('role'),
        organizationId: org.id,
        name: roleName,
        description: `${roleName} (system role)`,
        isSystem: true,
        permissions: { connect: grants.map((k) => ({ id: permId.get(k)! })) },
      },
    });
    roleIdByName[roleName] = role.id;
  }
  bump('roles', Object.keys(roleIdByName).length);

  const team = await prisma.team.create({ data: { id: mkId('team'), organizationId: org.id, name: 'Core Team' } });
  bump('teams', 1);

  return { org, roleIdByName, teamId: team.id };
}

async function createUser(
  orgId: string,
  teamId: string,
  roleId: string,
  opts: { firstName: string; lastName: string; email: string; clerkUserId: string; timezone: string },
): Promise<string> {
  const user = await prisma.user.create({
    data: {
      id: mkId('user'),
      organizationId: orgId,
      clerkUserId: opts.clerkUserId,
      email: opts.email,
      firstName: opts.firstName,
      lastName: opts.lastName,
      timezone: opts.timezone,
    },
  });
  await prisma.userRole.create({ data: { id: mkId('ur'), organizationId: orgId, userId: user.id, roleId } });
  await prisma.teamMembership.create({ data: { id: mkId('tm'), organizationId: orgId, userId: user.id, teamId } });
  bump('users', 1);
  return user.id;
}

// ---------------------------------------------------------------------------
// Primary org — the rich dataset.
// ---------------------------------------------------------------------------
async function seedPrimaryOrg(): Promise<void> {
  const clerkOrgId = process.env.SEED_CLERK_ORG_ID || 'org_seed_placeholder';
  const { org, roleIdByName, teamId } = await bootstrapOrg('Acme Inc', 'acme', clerkOrgId);

  // Users: 1 admin (owner role → org-wide), 1 manager (admin role → team),
  // 4 reps (member role → own). The real Clerk identity binds to the admin so
  // you can sign in and see everything; override via SEED_CLERK_* in .env.
  const tz = 'Asia/Kolkata';
  const adminId = await createUser(org.id, teamId, roleIdByName[SYSTEM_ROLES.OWNER], {
    firstName: 'Aarav',
    lastName: 'Admin',
    email: process.env.SEED_USER_EMAIL || 'admin@acme.test',
    clerkUserId: process.env.SEED_CLERK_USER_ID || 'user_seed_admin',
    timezone: tz,
  });
  const managerId = await createUser(org.id, teamId, roleIdByName[SYSTEM_ROLES.ADMIN], {
    firstName: 'Meera',
    lastName: 'Manager',
    email: 'manager@acme.test',
    clerkUserId: 'user_seed_manager',
    timezone: tz,
  });
  const repNames = [
    ['Rohan', 'Sharma'],
    ['Priya', 'Iyer'],
    ['Vikram', 'Nair'],
    ['Ananya', 'Reddy'],
  ];
  const repIds: string[] = [];
  for (let i = 0; i < repNames.length; i++) {
    const [firstName, lastName] = repNames[i];
    repIds.push(
      await createUser(org.id, teamId, roleIdByName[SYSTEM_ROLES.MEMBER], {
        firstName,
        lastName,
        email: `${firstName.toLowerCase()}@acme.test`,
        clerkUserId: `user_seed_rep_${i + 1}`,
        // Mostly IST; give one rep a different tz to exercise timezone handling.
        timezone: i === 3 ? 'America/New_York' : tz,
      }),
    );
  }
  const allUserIds = [adminId, managerId, ...repIds];

  // Custom field definitions.
  await prisma.customFieldDefinition.createMany({
    data: [
      { id: mkId('cfd'), organizationId: org.id, entityType: 'CONTACT', key: 'linkedin', label: 'LinkedIn', fieldType: 'TEXT', order: 0 },
      { id: mkId('cfd'), organizationId: org.id, entityType: 'CONTACT', key: 'seniority', label: 'Seniority', fieldType: 'SELECT', options: ['Junior', 'Mid', 'Senior', 'Exec'], order: 1 },
      { id: mkId('cfd'), organizationId: org.id, entityType: 'COMPANY', key: 'arr', label: 'ARR (₹)', fieldType: 'NUMBER', order: 0 },
      { id: mkId('cfd'), organizationId: org.id, entityType: 'LEAD', key: 'priority', label: 'Priority', fieldType: 'SELECT', options: ['Low', 'Medium', 'High'], order: 0 },
    ],
  });
  bump('customFieldDefinitions', 4);

  // Tags.
  const tags = Array.from({ length: COUNTS.tags }, (_, i) => ({
    id: mkId('tag'),
    organizationId: org.id,
    name: TAG_NAMES[i % TAG_NAMES.length],
    color: `#${faker.string.hexadecimal({ length: 6, casing: 'lower', prefix: '' })}`,
    createdAt: HISTORY_START,
    updatedAt: HISTORY_START,
  }));
  await prisma.tag.createMany({ data: tags });
  bump('tags', tags.length);

  // Companies.
  const companies = Array.from({ length: COUNTS.companies }, () => {
    const created = between(HISTORY_START, NOW);
    const name = faker.company.name();
    return {
      id: mkId('co'),
      organizationId: org.id,
      name,
      domain: faker.internet.domainName(),
      industry: pick(INDUSTRIES),
      size: pick(SIZES),
      website: `https://${faker.internet.domainName()}`,
      phone: faker.phone.number(),
      ownerId: pick(repIds),
      customFields: (maybe(0.5) ? { arr: faker.number.int({ min: 5, max: 500 }) * 100000 } : {}) as Prisma.InputJsonValue,
      createdAt: created,
      updatedAt: created,
    };
  });
  await chunkCreate((rows) => prisma.company.createMany({ data: rows }), companies);
  bump('companies', companies.length);

  // Contacts (linked to companies; ~15% with custom fields).
  const contacts = Array.from({ length: COUNTS.contacts }, () => {
    const created = between(HISTORY_START, NOW);
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const company = maybe(0.8) ? pick(companies) : null;
    return {
      id: mkId('ct'),
      organizationId: org.id,
      firstName,
      lastName,
      email: faker.internet.email({ firstName, lastName }).toLowerCase(),
      phone: faker.phone.number(),
      jobTitle: faker.person.jobTitle(),
      companyId: company?.id ?? null,
      ownerId: pick(repIds),
      customFields: (maybe(0.15)
        ? { linkedin: `in/${firstName.toLowerCase()}-${lastName.toLowerCase()}`, seniority: pick(['Junior', 'Mid', 'Senior', 'Exec']) }
        : {}) as Prisma.InputJsonValue,
      createdAt: created,
      updatedAt: created,
    };
  });
  await chunkCreate((rows) => prisma.contact.createMany({ data: rows }), contacts);
  bump('contacts', contacts.length);

  // Leads (~30% CONVERTED, linked to a real contact).
  const leads = Array.from({ length: COUNTS.leads }, () => {
    const created = between(HISTORY_START, NOW);
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const status = faker.helpers.weightedArrayElement([
      { weight: 30, value: 'NEW' as const },
      { weight: 20, value: 'CONTACTED' as const },
      { weight: 15, value: 'QUALIFIED' as const },
      { weight: 5, value: 'UNQUALIFIED' as const },
      { weight: 30, value: 'CONVERTED' as const },
    ]);
    return {
      id: mkId('ld'),
      organizationId: org.id,
      firstName,
      lastName,
      email: faker.internet.email({ firstName, lastName }).toLowerCase(),
      phone: faker.phone.number(),
      source: pick(LEAD_SOURCES),
      status,
      ownerId: pick(repIds),
      convertedContactId: status === 'CONVERTED' ? pick(contacts).id : null,
      customFields: (maybe(0.4) ? { priority: pick(['Low', 'Medium', 'High']) } : {}) as Prisma.InputJsonValue,
      createdAt: created,
      updatedAt: created,
    };
  });
  await chunkCreate((rows) => prisma.lead.createMany({ data: rows }), leads);
  bump('leads', leads.length);

  // Pipeline + 6 stages.
  const pipeline = await prisma.pipeline.create({
    data: { id: mkId('pl'), organizationId: org.id, name: 'Sales Pipeline', isDefault: true, position: 0, createdAt: HISTORY_START, updatedAt: HISTORY_START },
  });
  bump('pipelines', 1);
  const stageDefs = [
    { name: 'New', probability: 10, type: 'OPEN' as const },
    { name: 'Qualified', probability: 25, type: 'OPEN' as const },
    { name: 'Proposal', probability: 50, type: 'OPEN' as const },
    { name: 'Negotiation', probability: 75, type: 'OPEN' as const },
    { name: 'Won', probability: 100, type: 'WON' as const },
    { name: 'Lost', probability: 0, type: 'LOST' as const },
  ];
  const stages = stageDefs.map((s, i) => ({ id: mkId('st'), organizationId: org.id, pipelineId: pipeline.id, name: s.name, position: i, probability: s.probability, type: s.type, createdAt: HISTORY_START, updatedAt: HISTORY_START }));
  await prisma.stage.createMany({ data: stages });
  bump('stages', stages.length);
  const stageByName = new Map(stages.map((s) => [s.name, s]));
  const openStages = ['New', 'Qualified', 'Proposal', 'Negotiation'].map((n) => stageByName.get(n)!);
  const wonStage = stageByName.get('Won')!;
  const lostStage = stageByName.get('Lost')!;

  // Deals + coherent stage_history.
  const contactsByCompany = new Map<string, string[]>();
  for (const c of contacts) if (c.companyId) (contactsByCompany.get(c.companyId) ?? contactsByCompany.set(c.companyId, []).get(c.companyId)!).push(c.id);

  const dealRows: Prisma.DealCreateManyInput[] = [];
  const historyRows: Prisma.StageHistoryCreateManyInput[] = [];
  const dealActivity: Prisma.ActivityEventCreateManyInput[] = [];

  for (let i = 0; i < COUNTS.deals; i++) {
    const ownerId = pick(repIds);
    const company = pick(companies);
    const contactPool = contactsByCompany.get(company.id);
    const contactId = contactPool?.length ? pick(contactPool) : maybe(0.7) ? pick(contacts).id : null;
    const createdAt = between(HISTORY_START, NOW);
    const amountMinor = rupeesToPaise(faker.number.int({ min: 50, max: 5_000 }) * 100); // ₹5k–₹500k

    // Note: the brief's "35% WON / 20% LOST" would yield a 64% win rate, which
    // conflicts with its "win rate ~35-45%" acceptance. We honor the win-rate
    // target (the tighter numeric criterion): 24% WON / 31% LOST / 45% OPEN →
    // win rate = 24/(24+31) ≈ 44%, with OPEN kept at 45%.
    const outcome = faker.helpers.weightedArrayElement([
      { weight: 24, value: 'WON' as const },
      { weight: 31, value: 'LOST' as const },
      { weight: 45, value: 'OPEN' as const },
    ]);

    // The ordered stages this deal passed through.
    let path: typeof stages;
    let status: 'WON' | 'LOST' | 'OPEN';
    let closedAt: Date | null = null;
    if (outcome === 'WON') {
      path = [...openStages, wonStage];
      status = 'WON';
      closedAt = between(createdAt, NOW);
    } else if (outcome === 'LOST') {
      const dropAt = faker.number.int({ min: 1, max: openStages.length }); // reached at least New
      path = [...openStages.slice(0, dropAt), lostStage];
      status = 'LOST';
      closedAt = between(createdAt, NOW);
    } else {
      const idx = faker.helpers.weightedArrayElement([
        { weight: 35, value: 0 },
        { weight: 30, value: 1 },
        { weight: 20, value: 2 },
        { weight: 15, value: 3 },
      ]);
      path = openStages.slice(0, idx + 1);
      status = 'OPEN';
    }
    const current = path[path.length - 1];
    const endTime = closedAt ?? NOW;
    const expectedCloseDate = status === 'OPEN' ? faker.date.soon({ days: 90, refDate: NOW }) : new Date((closedAt ?? NOW).getTime());

    const dealId = mkId('dl');
    dealRows.push({
      id: dealId,
      organizationId: org.id,
      name: `${company.name} — ${faker.commerce.productName()}`,
      pipelineId: pipeline.id,
      stageId: current.id,
      amountMinor,
      currency: 'INR',
      expectedCloseDate,
      ownerId,
      contactId,
      companyId: company.id,
      status,
      closedAt,
      createdAt,
      updatedAt: endTime,
    });
    dealActivity.push({ id: mkId('ae'), organizationId: org.id, entityType: 'DEAL', entityId: dealId, actorId: ownerId, eventType: 'CREATED', source: 'seed', createdAt });

    // stage_history: increasing timestamps between createdAt and endTime.
    const k = path.length;
    const inner = Array.from({ length: Math.max(0, k - 2) }, () => between(createdAt, endTime)).sort((a, b) => a.getTime() - b.getTime());
    const times = k <= 1 ? [createdAt] : [createdAt, ...inner, endTime];
    for (let s = 0; s < path.length; s++) {
      const changedAt = times[s];
      const prev = s === 0 ? null : path[s - 1];
      historyRows.push({
        id: mkId('sh'),
        organizationId: org.id,
        dealId,
        fromStageId: prev?.id ?? null,
        toStageId: path[s].id,
        changedById: ownerId,
        changedAt,
        secondsInPreviousStage: prev ? Math.max(0, Math.floor((changedAt.getTime() - times[s - 1].getTime()) / 1000)) : null,
      });
      if (s > 0) {
        const evt = path[s].type === 'WON' ? 'WON' : path[s].type === 'LOST' ? 'LOST' : 'STAGE_CHANGED';
        dealActivity.push({ id: mkId('ae'), organizationId: org.id, entityType: 'DEAL', entityId: dealId, actorId: ownerId, eventType: evt, metadata: { toStageName: path[s].name } as Prisma.InputJsonValue, source: 'seed', createdAt: changedAt });
      }
    }
  }
  await chunkCreate((rows) => prisma.deal.createMany({ data: rows }), dealRows);
  await chunkCreate((rows) => prisma.stageHistory.createMany({ data: rows }), historyRows);
  bump('deals', dealRows.length);
  bump('stageHistory', historyRows.length);

  // Tasks: realistic OPEN (overdue/today/upcoming) + DONE mix; meetings have start/end.
  const taskRows: Prisma.TaskCreateManyInput[] = [];
  const reminderRows: Prisma.ReminderCreateManyInput[] = [];
  const taskActivity: Prisma.ActivityEventCreateManyInput[] = [];
  const startOfToday = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());
  for (let i = 0; i < COUNTS.tasks; i++) {
    const type = pick(TASK_TYPES);
    const assigneeId = pick([...repIds, managerId]);
    const createdAt = between(HISTORY_START, NOW);
    const linkToDeal = maybe(0.5);
    const relatedType = linkToDeal ? 'DEAL' : maybe(0.7) ? 'CONTACT' : null;
    const relatedId = relatedType === 'DEAL' ? pick(dealRows).id : relatedType === 'CONTACT' ? pick(contacts).id : null;

    const bucket = faker.helpers.weightedArrayElement([
      { weight: 20, value: 'overdue' as const },
      { weight: 10, value: 'today' as const },
      { weight: 25, value: 'upcoming' as const },
      { weight: 45, value: 'done' as const },
    ]);

    let status: 'OPEN' | 'DONE' = 'OPEN';
    let dueAt: Date | null = null;
    let completedAt: Date | null = null;
    let outcome: string | null = null;
    if (bucket === 'overdue') dueAt = between(HISTORY_START, new Date(NOW.getTime() - 86_400_000));
    else if (bucket === 'today') dueAt = new Date(startOfToday.getTime() + faker.number.int({ min: 8, max: 20 }) * 3_600_000);
    else if (bucket === 'upcoming') dueAt = faker.date.soon({ days: 30, refDate: NOW });
    else {
      status = 'DONE';
      dueAt = between(HISTORY_START, NOW);
      completedAt = between(dueAt, NOW);
      outcome = pick(TASK_OUTCOMES);
    }

    const isMeeting = type === 'MEETING';
    const startAt = isMeeting ? (dueAt ?? faker.date.soon({ days: 14, refDate: NOW })) : null;
    const endAt = startAt ? new Date(startAt.getTime() + 3_600_000) : null;

    const taskId = mkId('tk');
    taskRows.push({
      id: taskId,
      organizationId: org.id,
      type,
      title: `${type === 'CALL' ? 'Call' : type === 'MEETING' ? 'Meeting' : type === 'FOLLOW_UP' ? 'Follow up' : 'Task'}: ${faker.company.buzzPhrase()}`,
      description: maybe(0.5) ? faker.lorem.sentence() : null,
      status,
      priority: pick(['LOW', 'MEDIUM', 'HIGH'] as const),
      dueAt: isMeeting ? null : dueAt,
      startAt,
      endAt,
      location: isMeeting ? pick(['Zoom', 'Google Meet', 'Office', 'Client site']) : null,
      meetingUrl: isMeeting ? faker.internet.url() : null,
      assigneeId,
      createdById: maybe(0.7) ? assigneeId : managerId,
      relatedType,
      relatedId,
      completedAt,
      outcome,
      createdAt,
      updatedAt: completedAt ?? createdAt,
    });

    // A reminder on some upcoming open tasks.
    if (status === 'OPEN' && bucket === 'upcoming' && dueAt && maybe(0.4)) {
      reminderRows.push({ id: mkId('rm'), organizationId: org.id, taskId, remindAt: new Date(dueAt.getTime() - 3_600_000), channels: ['IN_APP', 'EMAIL', 'PUSH'], status: 'SCHEDULED', createdAt });
    }
    // Task-completed activity on the related record's timeline.
    if (status === 'DONE' && relatedType && relatedId) {
      taskActivity.push({ id: mkId('ae'), organizationId: org.id, entityType: relatedType, entityId: relatedId, actorId: assigneeId, eventType: 'TASK_COMPLETED', metadata: { taskId, title: 'task' } as Prisma.InputJsonValue, source: 'seed', createdAt: completedAt ?? createdAt });
    }
  }
  await chunkCreate((rows) => prisma.task.createMany({ data: rows }), taskRows);
  await chunkCreate((rows) => prisma.reminder.createMany({ data: rows }), reminderRows);
  bump('tasks', taskRows.length);
  bump('reminders', reminderRows.length);

  // Notes on ~20% of contacts and deals (+ NOTE_ADDED activity).
  const noteRows: Prisma.NoteCreateManyInput[] = [];
  const noteActivity: Prisma.ActivityEventCreateManyInput[] = [];
  const addNote = (entityType: 'CONTACT' | 'DEAL', entityId: string, createdAt: Date) => {
    const authorId = pick(allUserIds);
    const id = mkId('nt');
    noteRows.push({ id, organizationId: org.id, entityType, entityId, authorId, body: faker.lorem.sentences(2), createdAt, updatedAt: createdAt });
    noteActivity.push({ id: mkId('ae'), organizationId: org.id, entityType, entityId, actorId: authorId, eventType: 'NOTE_ADDED', source: 'seed', createdAt });
  };
  for (const c of contacts) if (maybe(0.2)) addNote('CONTACT', c.id, between(c.createdAt, NOW));
  for (const d of dealRows) if (maybe(0.2)) addNote('DEAL', d.id!, between(d.createdAt as Date, NOW));
  await chunkCreate((rows) => prisma.note.createMany({ data: rows }), noteRows);
  bump('notes', noteRows.length);

  // CREATED activity for companies/contacts/leads (deals already emitted above).
  const createdActivity: Prisma.ActivityEventCreateManyInput[] = [
    ...companies.map((c) => ({ id: mkId('ae'), organizationId: org.id, entityType: 'COMPANY' as const, entityId: c.id, actorId: c.ownerId, eventType: 'CREATED' as const, source: 'seed', createdAt: c.createdAt })),
    ...contacts.map((c) => ({ id: mkId('ae'), organizationId: org.id, entityType: 'CONTACT' as const, entityId: c.id, actorId: c.ownerId, eventType: 'CREATED' as const, source: 'seed', createdAt: c.createdAt })),
    ...leads.map((l) => ({ id: mkId('ae'), organizationId: org.id, entityType: 'LEAD' as const, entityId: l.id, actorId: l.ownerId, eventType: 'CREATED' as const, source: 'seed', createdAt: l.createdAt })),
  ];
  const allActivity = [...createdActivity, ...dealActivity, ...taskActivity, ...noteActivity];
  await chunkCreate((rows) => prisma.activityEvent.createMany({ data: rows }), allActivity);
  bump('activityEvents', allActivity.length);

  // Taggables across contacts / companies / deals (unique per (tag, entity)).
  const taggableRows: Prisma.TaggableCreateManyInput[] = [];
  const tagAssign = (entityType: 'CONTACT' | 'COMPANY' | 'DEAL', entityId: string) => {
    const chosen = faker.helpers.arrayElements(tags, faker.number.int({ min: 1, max: 2 }));
    for (const t of chosen) taggableRows.push({ id: mkId('tg'), organizationId: org.id, tagId: t.id, entityType, entityId });
  };
  for (const c of contacts) if (maybe(0.3)) tagAssign('CONTACT', c.id);
  for (const c of companies) if (maybe(0.4)) tagAssign('COMPANY', c.id);
  for (const d of dealRows) if (maybe(0.3)) tagAssign('DEAL', d.id!);
  await chunkCreate((rows) => prisma.taggable.createMany({ data: rows }), taggableRows);
  bump('taggables', taggableRows.length);

  // A few notifications per user (some unread) — push_tokens intentionally empty.
  const notifRows: Prisma.NotificationCreateManyInput[] = [];
  for (const uid of [...repIds, managerId]) {
    for (let n = 0; n < faker.number.int({ min: 2, max: 5 }); n++) {
      const createdAt = between(new Date(NOW.getTime() - 14 * 86_400_000), NOW);
      notifRows.push({
        id: mkId('nf'),
        organizationId: org.id,
        userId: uid,
        type: pick(['REMINDER', 'ASSIGNMENT', 'SYSTEM'] as const),
        title: faker.helpers.arrayElement(['Reminder: follow up', 'You were assigned a task', 'Deal moved to Proposal']),
        body: faker.lorem.sentence(),
        readAt: maybe(0.5) ? createdAt : null,
        deliveredChannels: ['IN_APP'],
        createdAt,
        updatedAt: createdAt,
      });
    }
  }
  await prisma.notification.createMany({ data: notifRows });
  bump('notifications', notifRows.length);
}

// ---------------------------------------------------------------------------
// Second org — tiny, to prove tenant isolation.
// ---------------------------------------------------------------------------
async function seedSecondOrg(): Promise<void> {
  const { org, roleIdByName, teamId } = await bootstrapOrg('Globex Partners', 'globex-partners');
  const ownerId = await createUser(org.id, teamId, roleIdByName[SYSTEM_ROLES.OWNER], {
    firstName: 'Gita',
    lastName: 'Owner',
    email: 'owner@globex.test',
    clerkUserId: 'user_seed_globex_owner',
    timezone: 'Asia/Kolkata',
  });

  const companies = Array.from({ length: 3 }, () => {
    const createdAt = between(HISTORY_START, NOW);
    return { id: mkId('co'), organizationId: org.id, name: faker.company.name(), domain: faker.internet.domainName(), industry: pick(INDUSTRIES), ownerId, createdAt, updatedAt: createdAt };
  });
  await prisma.company.createMany({ data: companies });
  bump('companies', companies.length);

  const contacts = Array.from({ length: 5 }, () => {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const createdAt = between(HISTORY_START, NOW);
    return { id: mkId('ct'), organizationId: org.id, firstName, lastName, email: faker.internet.email({ firstName, lastName }).toLowerCase(), companyId: pick(companies).id, ownerId, createdAt, updatedAt: createdAt };
  });
  await prisma.contact.createMany({ data: contacts });
  bump('contacts', contacts.length);

  const pipeline = await prisma.pipeline.create({ data: { id: mkId('pl'), organizationId: org.id, name: 'Sales Pipeline', isDefault: true, createdAt: HISTORY_START, updatedAt: HISTORY_START } });
  bump('pipelines', 1);
  const st = ['New', 'Qualified', 'Won', 'Lost'].map((name, i) => ({ id: mkId('st'), organizationId: org.id, pipelineId: pipeline.id, name, position: i, probability: [10, 40, 100, 0][i], type: (name === 'Won' ? 'WON' : name === 'Lost' ? 'LOST' : 'OPEN') as 'OPEN' | 'WON' | 'LOST', createdAt: HISTORY_START, updatedAt: HISTORY_START }));
  await prisma.stage.createMany({ data: st });
  bump('stages', st.length);

  for (let i = 0; i < 4; i++) {
    const createdAt = between(HISTORY_START, NOW);
    const stage = pick(st);
    const dealId = mkId('dl');
    await prisma.deal.create({ data: { id: dealId, organizationId: org.id, name: `${pick(companies).name} — pilot`, pipelineId: pipeline.id, stageId: stage.id, amountMinor: rupeesToPaise(faker.number.int({ min: 50, max: 500 }) * 100), currency: 'INR', ownerId, companyId: pick(companies).id, contactId: pick(contacts).id, status: stage.type === 'WON' ? 'WON' : stage.type === 'LOST' ? 'LOST' : 'OPEN', closedAt: stage.type === 'OPEN' ? null : createdAt, createdAt, updatedAt: createdAt } });
    await prisma.stageHistory.create({ data: { id: mkId('sh'), organizationId: org.id, dealId, fromStageId: null, toStageId: stage.id, changedById: ownerId, changedAt: createdAt } });
    bump('deals', 1);
    bump('stageHistory', 1);
  }
}

// ---------------------------------------------------------------------------
// Re-run: clear seeded tables (children first, FK-safe).
// ---------------------------------------------------------------------------
async function clearAll(): Promise<void> {
  await prisma.reminder.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.pushToken.deleteMany();
  await prisma.task.deleteMany();
  await prisma.stageHistory.deleteMany();
  await prisma.deal.deleteMany();
  await prisma.stage.deleteMany();
  await prisma.pipeline.deleteMany();
  await prisma.taggable.deleteMany();
  await prisma.note.deleteMany();
  await prisma.activityEvent.deleteMany();
  await prisma.customFieldDefinition.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.company.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.teamMembership.deleteMany();
  await prisma.userRole.deleteMany();
  await prisma.permission.deleteMany();
  await prisma.role.deleteMany();
  await prisma.team.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();
}

async function main(): Promise<void> {
  assertLocalDb();
  faker.seed(FAKER_SEED);

  console.log(`\n🌱 Seeding LOCAL database — mode=${MODE} (fixed faker seed ${FAKER_SEED})`);
  console.log('   Clearing existing rows…');
  await clearAll();

  await seedPrimaryOrg();
  await seedSecondOrg();

  console.log('\n✅ Seed complete. Rows created:');
  for (const k of Object.keys(summary).sort()) console.log(`   ${k.padEnd(22)} ${summary[k].toLocaleString()}`);
  console.log('\n   Primary org: Acme Inc (slug "acme") — admin/manager/4 reps, INR deals across 6 stages.');
  console.log('   Sign in as the admin: set SEED_CLERK_USER_ID (+ SEED_CLERK_ORG_ID) in apps/api/.env and re-run.\n');
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
