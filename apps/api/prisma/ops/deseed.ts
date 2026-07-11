/* eslint-disable no-console */
/**
 * De-seed: remove ONLY non-Shopify seed/demo data so the CRM shows only real
 * Shopify data. Preserves ALL real Shopify rows, the real admin (user_1) + org_1
 * RBAC (roles/permissions/team), the Integration rows, the real MARKETING
 * consents, and any real guest customer (null externalId).
 *
 * DRY-RUN by default (counts only). Pass --apply to execute in one transaction.
 *
 *   corepack pnpm --filter @crm/api exec tsx prisma/ops/deseed.ts          # dry-run
 *   corepack pnpm --filter @crm/api exec tsx prisma/ops/deseed.ts --apply  # execute
 *
 * NOTE: identifiers below (org_1, user_1, the seed users, org_2) are specific to
 * this store's seed. Review before reusing on another dataset.
 */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
for (const line of readFileSync(new URL('../../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (m && !line.trimStart().startsWith('#')) process.env[m[1]] = m[2];
}
const APPLY = process.argv.includes('--apply');
// Use the DIRECT (non-pooled) endpoint — the pgbouncer pool was dropping under load.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } } });
const ORG = 'org_1';
const REAL_ADMIN = 'user_1';
const SEED_USERS = ['user_2', 'user_3', 'user_4', 'user_5', 'user_6']; // manager + 4 reps (acme.test)
const SEED_ORG = 'org_2'; // Globex — entirely seed

async function main() {
  console.log(`=== DE-SEED ${APPLY ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  // ---- Pre-flight safety checks (must all hold or we abort) ----
  const realOrders = await prisma.order.count({ where: { organizationId: ORG, externalId: { not: { startsWith: 'shp_' } } } });
  const realCusts = await prisma.customer.count({ where: { organizationId: ORG, externalId: { not: null } } });
  const admin = await prisma.user.findUnique({ where: { id: REAL_ADMIN } });
  console.log(`Preserving: realOrders=${realOrders} realCustomers=${realCusts} admin=${admin?.email}`);
  if (!admin || realOrders < 30000) throw new Error('Safety check failed — aborting (admin missing or too few real orders).');

  // ---- Count what will be deleted (for the report + audit) ----
  const counts: Record<string, number> = {};
  const c = async (label: string, n: Promise<number>) => { counts[label] = await n; };
  await c('product.fake', prisma.product.count({ where: { organizationId: ORG, externalId: { startsWith: 'shp_' } } }));
  await c('call', prisma.call.count({ where: { organizationId: ORG } }));
  await c('consent.callRecording', prisma.consent.count({ where: { organizationId: ORG, purpose: 'CALL_RECORDING' } }));
  await c('tag', prisma.tag.count({ where: { organizationId: ORG } }));
  await c('taggable', prisma.taggable.count({ where: { organizationId: ORG } }));
  await c('customFieldDefinition', prisma.customFieldDefinition.count({ where: { organizationId: ORG } }));
  await c('notification.seed', prisma.notification.count({ where: { organizationId: ORG, OR: [{ userId: { in: SEED_USERS } }, { id: { startsWith: 'nf_' } }] } }));
  await c('campaignSend', prisma.campaignSend.count({ where: { organizationId: ORG } }));
  await c('campaignEnrollment', prisma.campaignEnrollment.count({ where: { organizationId: ORG } }));
  await c('campaign', prisma.campaign.count({ where: { organizationId: ORG } }));
  await c('messageTemplate', prisma.messageTemplate.count({ where: { organizationId: ORG } }));
  await c('suppression', prisma.suppression.count({ where: { organizationId: ORG } }));
  await c('note', prisma.note.count({ where: { organizationId: ORG } }));
  await c('activityEvent', prisma.activityEvent.count({ where: { organizationId: ORG } }));
  await c('reminder', prisma.reminder.count({ where: { organizationId: ORG } }));
  await c('task', prisma.task.count({ where: { organizationId: ORG } }));
  await c('stageHistory.org1', prisma.stageHistory.count({ where: { organizationId: ORG } }));
  await c('deal.org1', prisma.deal.count({ where: { organizationId: ORG } }));
  await c('stage.org1', prisma.stage.count({ where: { organizationId: ORG } }));
  await c('pipeline.org1', prisma.pipeline.count({ where: { organizationId: ORG } }));
  await c('lead.org1', prisma.lead.count({ where: { organizationId: ORG } }));
  await c('contact.org1', prisma.contact.count({ where: { organizationId: ORG } }));
  await c('company.org1', prisma.company.count({ where: { organizationId: ORG } }));
  await c('user.seed', prisma.user.count({ where: { organizationId: ORG, id: { in: SEED_USERS } } }));
  await c('org2.company', prisma.company.count({ where: { organizationId: SEED_ORG } }));
  await c('org2.contact', prisma.contact.count({ where: { organizationId: SEED_ORG } }));
  await c('org2.deal', prisma.deal.count({ where: { organizationId: SEED_ORG } }));
  await c('org2.user', prisma.user.count({ where: { organizationId: SEED_ORG } }));
  const seedOrg = await prisma.organization.findUnique({ where: { id: SEED_ORG } });
  counts['org2.organization'] = seedOrg ? 1 : 0;

  console.log('\nWill DELETE:');
  for (const k of Object.keys(counts)) console.log(`  ${k.padEnd(26)} ${counts[k]}`);
  console.log(`  ${'TOTAL rows (approx)'.padEnd(26)} ${Object.values(counts).reduce((a, b) => a + b, 0)}`);

  if (!APPLY) { console.log('\nDRY-RUN — no changes. Re-run with --apply to execute.'); await prisma.$disconnect(); return; }

  // ---- Execute: one transaction, FK-safe order (children before parents) ----
  console.log('\nApplying in a single transaction…');
  await prisma.$transaction([
    prisma.product.deleteMany({ where: { organizationId: ORG, externalId: { startsWith: 'shp_' } } }),
    // M4 recovery demo (children → parents).
    prisma.campaignSend.deleteMany({ where: { organizationId: ORG } }),
    prisma.campaignEnrollment.deleteMany({ where: { organizationId: ORG } }),
    prisma.campaignStep.deleteMany({ where: { campaign: { organizationId: ORG } } }),
    prisma.campaign.deleteMany({ where: { organizationId: ORG } }),
    prisma.messageTemplate.deleteMany({ where: { organizationId: ORG } }),
    prisma.suppression.deleteMany({ where: { organizationId: ORG } }),
    // M5 telephony demo (calls + call-recording consent ONLY; marketing consent preserved).
    prisma.call.deleteMany({ where: { organizationId: ORG } }),
    prisma.consent.deleteMany({ where: { organizationId: ORG, purpose: 'CALL_RECORDING' } }),
    // Tagging / custom fields / seed notifications.
    prisma.taggable.deleteMany({ where: { organizationId: ORG } }),
    prisma.tag.deleteMany({ where: { organizationId: ORG } }),
    prisma.customFieldDefinition.deleteMany({ where: { organizationId: ORG } }),
    prisma.notification.deleteMany({ where: { organizationId: ORG, OR: [{ userId: { in: SEED_USERS } }, { id: { startsWith: 'nf_' } }] } }),
    // CRM sales demo in org_1 (children → parents).
    prisma.note.deleteMany({ where: { organizationId: ORG } }),
    prisma.activityEvent.deleteMany({ where: { organizationId: ORG } }),
    prisma.reminder.deleteMany({ where: { organizationId: ORG } }),
    prisma.task.deleteMany({ where: { organizationId: ORG } }),
    prisma.stageHistory.deleteMany({ where: { organizationId: ORG } }),
    prisma.deal.deleteMany({ where: { organizationId: ORG } }),
    prisma.stage.deleteMany({ where: { organizationId: ORG } }),
    prisma.pipeline.deleteMany({ where: { organizationId: ORG } }),
    prisma.lead.deleteMany({ where: { organizationId: ORG } }),
    prisma.contact.deleteMany({ where: { organizationId: ORG } }),
    prisma.company.deleteMany({ where: { organizationId: ORG } }),
    // Seed users (cascades their userRole + teamMembership). Real admin kept.
    prisma.user.deleteMany({ where: { organizationId: ORG, id: { in: SEED_USERS } } }),
    // Entire seed org (cascade wipes all its rows).
    prisma.organization.delete({ where: { id: SEED_ORG } }),
    // Audit summary.
    prisma.auditLog.create({ data: { organizationId: ORG, action: 'deseed.commerce-only', entity: 'CommerceCleanup', after: counts as any } }),
  ]);
  console.log('Done. Audit row written (AuditLog action=deseed.commerce-only).');
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error('FATAL:', e); await prisma.$disconnect(); process.exit(1); });
