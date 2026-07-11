/* eslint-disable no-console */
/**
 * SAFE DB-only Shopify backfill. Imports missing customers + orders into the CRM
 * using the app's REAL mappers + CommerceIngestService write logic (order, items,
 * customer identity resolution, interaction, features), but injects NO-OP stubs
 * for loyalty / incentives / marketing-consent so there are ZERO outbound
 * side-effects (no reward emails, no Shopify discount-code writes).
 *
 * Idempotent: only Shopify ids not already in the CRM are processed. Resilient:
 * retries page fetches on network errors and each DB unit on connection drops.
 *
 *   corepack pnpm --filter @crm/api exec tsx prisma/ops/safe-import.ts [--orders-only]
 *
 * --orders-only skips the customers pass (use when only order drift remains).
 */
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { CryptoService } from '../../src/common/crypto.service';
import { CustomerPiiService } from '../../src/customers/customer-pii.service';
import { AuditService } from '../../src/audit/audit.service';
import { IdentityService } from '../../src/customers/identity.service';
import { ShopifyService, parseNextPageInfo } from '../../src/ingestion/shopify.service';
import { CommerceIngestService } from '../../src/ingestion/commerce-ingest.service';
import { mapCustomer, mapOrder } from '../../src/ingestion/shopify.mappers';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True for transient DB/network connection failures worth retrying. */
function isConnErr(e: unknown): boolean {
  const m = String((e as any)?.message ?? e);
  return /Can't reach database|Server has closed|terminated|ECONNRESET|ETIMEDOUT|Timed out|Connection (?:reset|closed)|P1001|P1017/i.test(m);
}
/** Retry a (idempotent) unit of work on connection errors; rethrow others. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let a = 0; ; a++) {
    try { return await fn(); }
    catch (e) {
      if (!isConnErr(e) || a >= 8) throw e;
      await sleep(Math.min(15000, 500 * 2 ** a) + Math.floor(Math.random() * 250));
    }
  }
}

// Load every KEY=VALUE from apps/api/.env (last wins, like dotenv).
for (const line of readFileSync(new URL('../../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (m && !line.trimStart().startsWith('#')) process.env[m[1]] = m[2];
}

const ORG = process.env.IMPORT_ORG || 'org_1';
// Config defaults MUST match the running app (so PII hashing/encryption is
// byte-identical → correct dedup, no duplicate customers). .env may override.
const DEFAULTS: Record<string, unknown> = {
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || 'dev-only-insecure-encryption-key-change-me',
  ENCRYPTION_KEY_VERSION: Number(process.env.ENCRYPTION_KEY_VERSION || 1),
  HASH_PEPPER: process.env.HASH_PEPPER || 'dev-only-insecure-hash-pepper-change-me',
  SHOPIFY_API_VERSION: process.env.SHOPIFY_API_VERSION || '2024-10',
};
const cfg = { get: (k: string) => (k in DEFAULTS ? DEFAULTS[k] : process.env[k]) } as any;

async function getToken(domain: string): Promise<string> {
  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: process.env.SHOPIFY_API_KEY, client_secret: process.env.SHOPIFY_API_SECRET, grant_type: 'client_credentials' }),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (res.ok && body.access_token) return body.access_token;
  if (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) return process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  throw new Error(`token grant failed ${res.status}: ${body.error_description || body.error}`);
}

/**
 * Resilient cursor paginator: retries page fetches on transient network errors
 * (ECONNRESET / socket terminate), 429, and 5xx with backoff. Refreshes the
 * token once on 401. Same Link-header cursor logic as the app's ShopifyService.
 */
async function resilientPaginate(
  domain: string,
  apiVersion: string,
  getFreshToken: (force: boolean) => Promise<string>,
  resource: 'customers' | 'products' | 'orders',
  query: Record<string, string>,
  onBatch: (items: any[]) => Promise<void>,
): Promise<number> {
  let token = await getFreshToken(false);
  let path = `${resource}.json?${new URLSearchParams({ limit: '250', ...query }).toString()}`;
  let count = 0;
  for (let page = 0; page < 100000; page++) {
    let res: Response | null = null;
    let refreshed401 = false;
    for (let attempt = 0; attempt <= 10; attempt++) {
      try {
        res = await fetch(`https://${domain}/admin/api/${apiVersion}/${path}`, {
          headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        if (attempt === 10) throw err; // network failure (ECONNRESET / terminated)
        await sleep(Math.min(30000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250));
        continue;
      }
      if (res.status === 401 && !refreshed401) { refreshed401 = true; token = await getFreshToken(true); continue; }
      if (res.status === 429 || res.status >= 500) {
        if (attempt === 10) throw new Error(`Shopify ${res.status} after retries`);
        const ra = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(30000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250));
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        if ((res.status === 403 || res.status === 404) && /unavailable shop/i.test(body) && attempt < 10) {
          await sleep(Math.min(30000, 500 * 2 ** attempt)); continue;
        }
        throw new Error(`Shopify ${res.status}: ${body.slice(0, 200)}`);
      }
      break; // success
    }
    const json: any = await res!.json();
    const items = (json[resource] as any[]) ?? [];
    if (items.length) { await onBatch(items); count += items.length; }
    const next = parseNextPageInfo(res!.headers.get('link'));
    if (!next) break;
    path = `${resource}.json?${new URLSearchParams({ limit: '250', page_info: next }).toString()}`;
  }
  return count;
}

async function main() {
  // Use the DIRECT (non-pooled) endpoint — a single sustained importer is more
  // stable on a direct connection than the pgbouncer pool (which drops under load).
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } } });
  const crypto = new CryptoService(cfg);
  const pii = new CustomerPiiService(crypto, cfg);
  const audit = new AuditService(prisma as any);
  const identity = new IdentityService(prisma as any, audit, pii);

  const domain = process.env.SHOPIFY_SHOP_DOMAIN!;
  const apiVersion = DEFAULTS.SHOPIFY_API_VERSION as string;
  let tokenCache = await getToken(domain);
  const getFreshToken = async (force: boolean) => { if (force) tokenCache = await getToken(domain); return tokenCache; };
  const fakeToken = { getToken: async () => tokenCache } as any;
  const shopify = new ShopifyService(cfg, fakeToken);
  const conn = shopify.connection();
  if (!conn) throw new Error('no shopify connection (check SHOPIFY_SHOP_DOMAIN / API_KEY / API_SECRET)');

  const noop = async () => {};
  const ingest = new CommerceIngestService(
    prisma as any,
    identity,
    shopify,
    { recordFromShopify: noop } as any, // marketing consent — SKIP (no writes)
    { reconcileOrder: noop } as any,    // loyalty — SKIP
    { onOrder: noop, onRefund: noop } as any, // incentives (emails + Shopify discount writes) — SKIP
  );

  // Sets of ids already in the CRM (skip → idempotent, no re-processing).
  const existingOrders = new Set((await withRetry(() => prisma.order.findMany({ where: { organizationId: ORG }, select: { externalId: true } }))).map((r) => r.externalId));
  const existingCusts = new Set((await withRetry(() => prisma.customer.findMany({ where: { organizationId: ORG }, select: { externalId: true } }))).map((r) => r.externalId).filter(Boolean) as string[]);
  console.log(`start: existing orders=${existingOrders.size} customers=${existingCusts.size}`);

  // --- Customers pass: create only missing-by-externalId (identity resolution
  //     still dedups by email/phone). Covers customers who never ordered. ---
  const ORDERS_ONLY = process.argv.includes('--orders-only');
  if (!ORDERS_ONLY) {
    let cSeen = 0, cCreated = 0, cErr = 0;
    await resilientPaginate(domain, apiVersion, getFreshToken, 'customers', {}, async (items) => {
      for (const it of items) {
        cSeen++;
        const id = String((it as any).id);
        if (existingCusts.has(id)) continue;
        try { await withRetry(() => ingest.upsertCustomer(ORG, mapCustomer(it))); existingCusts.add(id); cCreated++; }
        catch (e) { cErr++; if (cErr <= 5) console.error(`cust ${id} err: ${(e as Error).message}`); }
      }
      if (cSeen % 5000 < 250) console.log(`  customers seen=${cSeen} created=${cCreated} err=${cErr}`);
    });
    console.log(`customers done: seen=${cSeen} created=${cCreated} err=${cErr}`);
  } else {
    console.log('customers done: SKIPPED (--orders-only)');
  }

  // --- Orders pass: safe upsert of missing orders (real order/items/customer/
  //     interaction/features; loyalty+incentive+consent stubbed no-op). Distinct
  //     customers run CONC-way concurrent; a customer's own orders stay sequential
  //     so there is never a features-recompute race. ---
  let oSeen = 0, oCreated = 0, oErr = 0;
  const CONC = 8;
  await resilientPaginate(domain, apiVersion, getFreshToken, 'orders', { status: 'any' }, async (items) => {
    const missing = items.filter((it) => !existingOrders.has(String((it as any).id)));
    oSeen += items.length - missing.length;
    const groups = new Map<string, any[]>();
    for (const it of missing) {
      const cust = (it as any).customer?.id ? `c:${(it as any).customer.id}` : (it as any).email ? `e:${String((it as any).email).toLowerCase()}` : `o:${(it as any).id}`;
      const g = groups.get(cust) ?? []; g.push(it); groups.set(cust, g);
    }
    const groupList = [...groups.values()];
    for (let i = 0; i < groupList.length; i += CONC) {
      await Promise.all(groupList.slice(i, i + CONC).map(async (grp) => {
        for (const it of grp) {
          const id = String((it as any).id);
          try { await withRetry(() => ingest.upsertOrder(ORG, mapOrder(it))); existingOrders.add(id); oCreated++; }
          catch (e) { oErr++; if (oErr <= 10) console.error(`order ${id} err: ${(e as Error).message}`); }
          oSeen++;
        }
      }));
    }
    if (oCreated && oSeen % 5000 < 250) console.log(`  orders seen=${oSeen} created=${oCreated} err=${oErr}`);
  });
  console.log(`orders done: seen=${oSeen} created=${oCreated} err=${oErr}`);

  const finalOrders = await prisma.order.count({ where: { organizationId: ORG, deletedAt: null } });
  const finalCusts = await prisma.customer.count({ where: { organizationId: ORG, deletedAt: null } });
  console.log(`FINAL CRM: orders=${finalOrders} customers=${finalCusts}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
