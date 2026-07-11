/* eslint-disable no-console */
/**
 * READ-ONLY final verification: only real Shopify data remains and nothing real
 * was deleted. Prints PASS/FAIL for each invariant. Writes nothing.
 *
 *   corepack pnpm --filter @crm/api exec tsx prisma/ops/verify.ts
 */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
for (const line of readFileSync(new URL('../../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = /^\s*(DATABASE_URL|DIRECT_URL)\s*=\s*(.*?)\s*$/.exec(line);
  if (m && !line.trimStart().startsWith('#')) process.env[m[1]] = m[2];
}
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } } });
const SEED_RE = { startsWith: 'shp_' };

async function main() {
  const ok = (b: boolean) => (b ? 'PASS' : '❌ FAIL');

  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  console.log('Organizations:', orgs.map((o) => `${o.id}:${o.name}`).join(', '));
  console.log('Users:', users.map((u) => u.email).join(', '));
  console.log(`  ${ok(orgs.length === 1 && orgs[0].id === 'org_1')} only org_1 remains`);
  console.log(`  ${ok(users.length === 1 && users[0].id === 'user_1')} only real admin user_1 remains`);

  const custSeed = await prisma.customer.count({ where: { externalId: SEED_RE } });
  const custNull = await prisma.customer.count({ where: { externalId: null } });
  const custTotal = await prisma.customer.count();
  const ordSeed = await prisma.order.count({ where: { externalId: SEED_RE } });
  const ordTotal = await prisma.order.count();
  const prodSeed = await prisma.product.count({ where: { externalId: SEED_RE } });
  const prodTotal = await prisma.product.count();
  console.log(`\nCustomers total=${custTotal} seedPrefixed=${custSeed} nullGuest=${custNull}`);
  console.log(`Orders    total=${ordTotal} seedPrefixed=${ordSeed}`);
  console.log(`Products  total=${prodTotal} seedPrefixed=${prodSeed}`);
  console.log(`  ${ok(custSeed === 0)} no seed-prefixed customers`);
  console.log(`  ${ok(ordSeed === 0)} no seed-prefixed orders`);
  console.log(`  ${ok(prodSeed === 0)} no seed-prefixed products`);

  const checks: Array<[string, number]> = [
    ['call', await prisma.call.count()],
    ['tag', await prisma.tag.count()],
    ['pipeline', await prisma.pipeline.count()],
    ['stage', await prisma.stage.count()],
    ['deal', await prisma.deal.count()],
    ['company', await prisma.company.count()],
    ['contact', await prisma.contact.count()],
    ['lead', await prisma.lead.count()],
    ['campaign', await prisma.campaign.count()],
    ['customFieldDefinition', await prisma.customFieldDefinition.count()],
    ['consent.CALL_RECORDING', await prisma.consent.count({ where: { purpose: 'CALL_RECORDING' } })],
  ];
  console.log('\nSeed demo tables (expect 0):');
  for (const [t, n] of checks) console.log(`  ${ok(n === 0)} ${t} = ${n}`);

  const mkt = await prisma.consent.count({ where: { purpose: 'MARKETING' } });
  const integrations = await prisma.integration.count();
  const roles = await prisma.role.count({ where: { organizationId: 'org_1' } });
  const perms = await prisma.permission.count({ where: { organizationId: 'org_1' } });
  console.log('\nPreserved (real):');
  console.log(`  MARKETING consents=${mkt}  integrations=${integrations}  roles=${roles} perms=${perms}`);
  console.log(`  ${ok(mkt > 20000)} marketing consents preserved`);
  console.log(`  ${ok(integrations >= 1)} Integration rows preserved`);
  console.log(`  ${ok(roles > 0 && perms > 0)} RBAC preserved`);

  const rev = await prisma.order.aggregate({ where: { status: { in: ['PAID', 'FULFILLED'] }, deletedAt: null }, _sum: { totalMinor: true, refundedMinor: true }, _count: { _all: true } });
  const net = ((rev._sum.totalMinor ?? 0) - (rev._sum.refundedMinor ?? 0)) / 100;
  console.log(`\nRevenue: paid/fulfilled orders=${rev._count._all}  net=₹${net.toLocaleString('en-IN')}`);
}
main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
