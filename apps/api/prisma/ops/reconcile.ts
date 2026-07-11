/* eslint-disable no-console */
/**
 * READ-ONLY reconciliation. Hits Shopify count endpoints (cheap) via the app's
 * client-credentials grant and compares to CRM row counts. Writes nothing.
 *
 *   corepack pnpm --filter @crm/api exec tsx prisma/ops/reconcile.ts
 */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

// Load every KEY=VALUE from apps/api/.env (last wins, like dotenv).
for (const line of readFileSync(new URL('../../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (m && !line.trimStart().startsWith('#')) process.env[m[1]] = m[2];
}

const prisma = new PrismaClient();
const DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN!;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-10';
const ORG = process.env.RECON_ORG || 'org_1';

async function getToken(): Promise<string> {
  const clientId = process.env.SHOPIFY_API_KEY;
  const clientSecret = process.env.SHOPIFY_API_SECRET;
  if (clientId && clientSecret) {
    const res = await fetch(`https://${DOMAIN}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
    });
    const body = (await res.json().catch(() => ({}))) as any;
    if (res.ok && body.access_token) return body.access_token;
    console.warn(`client-credentials grant failed (${res.status}: ${body.error_description || body.error}) — trying static token`);
  }
  if (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) return process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  throw new Error('No Shopify token available');
}

async function shopifyGet(token: string, path: string): Promise<any> {
  const res = await fetch(`https://${DOMAIN}/admin/api/${API_VERSION}/${path}`, {
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Shopify ${res.status} on ${path}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function main() {
  const token = await getToken();
  console.log(`Shopify store: ${DOMAIN} (API ${API_VERSION})\n`);

  const [ordC, custC, prodC, shop] = await Promise.all([
    shopifyGet(token, 'orders/count.json?status=any'),
    shopifyGet(token, 'customers/count.json'),
    shopifyGet(token, 'products/count.json'),
    shopifyGet(token, 'shop.json'),
  ]);
  const shopifyOrders = Number(ordC.count ?? 0);
  const shopifyCustomers = Number(custC.count ?? 0);
  const shopifyProducts = Number(prodC.count ?? 0);
  console.log(`Shop: ${shop.shop?.name}  currency=${shop.shop?.currency}\n`);

  const crmOrders = await prisma.order.count({ where: { organizationId: ORG, deletedAt: null } });
  const crmProductsReal = await prisma.product.count({ where: { organizationId: ORG, deletedAt: null, NOT: { externalId: { startsWith: 'shp_' } } } });
  const crmCustReal = await prisma.customer.count({ where: { organizationId: ORG, deletedAt: null, externalId: { not: null } } });
  const crmGuests = await prisma.customer.count({ where: { organizationId: ORG, deletedAt: null, externalId: null } });

  const row = (label: string, shopify: number, crm: number, note = '') =>
    console.log(`  ${label.padEnd(11)} shopify=${String(shopify).padStart(7)}  crm=${String(crm).padStart(7)}  drift=${String(crm - shopify).padStart(6)}  ${note}`);

  console.log(`RECONCILIATION (CRM ${ORG} vs live Shopify):`);
  row('orders', shopifyOrders, crmOrders);
  // NOTE: CRM customer count is legitimately BELOW Shopify's raw count — identity
  // resolution collapses Shopify email/phone-duplicate customers into one row.
  row('customers', shopifyCustomers, crmCustReal, `(+${crmGuests} guest; CRM dedups Shopify duplicates)`);
  row('products', shopifyProducts, crmProductsReal);
}
main().then(() => prisma.$disconnect()).catch(async (e) => { console.error('ERROR:', e.message); await prisma.$disconnect(); process.exit(1); });
