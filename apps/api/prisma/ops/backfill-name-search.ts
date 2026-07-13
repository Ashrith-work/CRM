/* eslint-disable no-console */
/**
 * Backfill Customer.nameSearch — the normalized plaintext name that powers the
 * pg_trgm-indexed name typeahead. Decrypts each customer's name in-app and writes
 * the lowercased searchable form. DB-only, no Shopify. Batches per page.
 *
 *   corepack pnpm --filter @crm/api exec tsx prisma/ops/backfill-name-search.ts
 */
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { CryptoService } from '../../src/common/crypto.service';
import { CustomerPiiService } from '../../src/customers/customer-pii.service';
for (const l of readFileSync(new URL('../../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l); if (m && !l.trimStart().startsWith('#')) process.env[m[1]] = m[2];
}
const D: any = { ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || 'dev-only-insecure-encryption-key-change-me', ENCRYPTION_KEY_VERSION: 1, HASH_PEPPER: process.env.HASH_PEPPER || 'dev-only-insecure-hash-pepper-change-me' };
const cfg: any = { get: (k: string) => (k in D ? D[k] : process.env[k]) };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let a = 0; ; a++) {
    try { return await fn(); }
    catch (e) { const m = String((e as any)?.message ?? e); if (a >= 8 || !/Can't reach database|Server has closed|terminated|ECONNRESET|Connection|P1001|P1017/i.test(m)) throw e; await sleep(Math.min(15000, 500 * 2 ** a)); }
  }
}

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
  const pii = new CustomerPiiService(new CryptoService(cfg), cfg);
  const PAGE = 2000;
  let cursor: string | undefined;
  let seen = 0, set = 0;

  for (;;) {
    const rows = await withRetry(() => prisma.customer.findMany({
      where: {}, orderBy: { id: 'asc' }, take: PAGE, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, firstName: true, lastName: true },
    }));
    if (!rows.length) break;
    const ops = rows.map((c) => {
      seen++;
      const { firstName, lastName } = pii.reveal({ firstName: c.firstName, lastName: c.lastName, email: null, phone: null });
      const nameSearch = pii.nameSearchOf(firstName, lastName);
      if (nameSearch) set++;
      return prisma.customer.update({ where: { id: c.id }, data: { nameSearch } });
    });
    await withRetry(() => prisma.$transaction(ops));
    cursor = rows[rows.length - 1].id;
    console.log(`  seen=${seen} withName=${set}`);
    if (rows.length < PAGE) break;
  }
  console.log(`\nDONE: seen=${seen} nameSearch set=${set}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
