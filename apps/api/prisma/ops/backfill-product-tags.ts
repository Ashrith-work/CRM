/* eslint-disable no-console */
/**
 * READ-ONLY backfill of Product.tags from Shopify product tags (for the "Fabrics"
 * field on the Purchase Analysis Dashboard). Paginates products, sets tags by
 * (org, externalId). No writes to Shopify, no emails. Batches each page into one
 * transaction; retries on connection drops.
 *
 *   corepack pnpm --filter @crm/api exec tsx prisma/ops/backfill-product-tags.ts
 */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
for (const line of readFileSync(new URL('../../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (m && !line.trimStart().startsWith('#')) process.env[m[1]] = m[2];
}
const ORG = process.env.IMPORT_ORG || 'org_1';
const DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN!;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-10';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseTags(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? raw.split(',') : [];
  return [...new Set(list.map((t) => t.trim()).filter(Boolean))];
}
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let a = 0; ; a++) {
    try { return await fn(); }
    catch (e) {
      const m = String((e as any)?.message ?? e);
      if (a >= 8 || !/Can't reach database|Server has closed|terminated|ECONNRESET|Connection|P1001|P1017/i.test(m)) throw e;
      await sleep(Math.min(15000, 500 * 2 ** a));
    }
  }
}
async function token(): Promise<string> {
  const res = await fetch(`https://${DOMAIN}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: process.env.SHOPIFY_API_KEY, client_secret: process.env.SHOPIFY_API_SECRET, grant_type: 'client_credentials' }),
  });
  const b = (await res.json().catch(() => ({}))) as any;
  if (res.ok && b.access_token) return b.access_token;
  if (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) return process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  throw new Error(`token grant failed ${res.status}`);
}
function nextPageInfo(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(',')) {
    if (!/rel="next"/.test(part)) continue;
    const m = part.match(/[?&]page_info=([^&>]+)/);
    if (m) return decodeURIComponent(m[1]);
  }
  return null;
}

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
  const tok = await token();
  let path = `products.json?${new URLSearchParams({ limit: '250', fields: 'id,tags' }).toString()}`;
  let seen = 0, updated = 0, withTags = 0;
  const tagCounts = new Map<string, number>();

  for (let page = 0; page < 100000; page++) {
    let res: Response | null = null;
    for (let a = 0; a <= 8; a++) {
      try { res = await fetch(`https://${DOMAIN}/admin/api/${API_VERSION}/${path}`, { headers: { 'X-Shopify-Access-Token': tok, 'Content-Type': 'application/json' } }); }
      catch { if (a === 8) throw new Error('network'); await sleep(500 * 2 ** a); continue; }
      if (res.status === 429 || res.status >= 500) { await sleep(500 * 2 ** a); continue; }
      break;
    }
    if (!res!.ok) throw new Error(`Shopify ${res!.status}: ${(await res!.text()).slice(0, 200)}`);
    const json: any = await res!.json();
    const items: any[] = json.products ?? [];
    const ops = items.map((p) => {
      seen++;
      const tags = parseTags(p.tags);
      if (tags.length) { withTags++; for (const t of tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1); }
      return prisma.product.updateMany({ where: { organizationId: ORG, externalId: String(p.id) }, data: { tags } });
    });
    const results = await withRetry(() => prisma.$transaction(ops));
    updated += results.reduce((s, r) => s + r.count, 0);
    console.log(`  products seen=${seen} updated=${updated} withTags=${withTags}`);
    const next = nextPageInfo(res!.headers.get('link'));
    if (!next) break;
    path = `products.json?${new URLSearchParams({ limit: '250', fields: 'id,tags', page_info: next }).toString()}`;
  }

  const top = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  console.log(`\nDONE: seen=${seen} updated=${updated} withTags=${withTags} distinctTags=${tagCounts.size}`);
  console.log('Top tags:', top.map(([t, n]) => `${t}(${n})`).join(', '));
  await prisma.$disconnect();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
