import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';

/** Pinned Shopify Admin API version — bump deliberately, never float. */
export const SHOPIFY_API_VERSION_DEFAULT = '2024-10';

const MAX_RETRIES = 6;

export interface ShopifyConn {
  shopDomain: string;
  accessToken: string;
  apiVersion: string;
}

/**
 * Shopify Admin API client (REST). Isolates all provider I/O: credential verify,
 * order count, and cursor-paginated iteration with leaky-bucket / 429 backoff.
 * Connection details come from the Integration config (shopDomain) + env
 * (access token); when unconfigured, callers get a clear error and the connector
 * reports not_connected.
 */
@Injectable()
export class ShopifyService {
  private readonly logger = new Logger(ShopifyService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  apiVersion(): string {
    return this.config.get('SHOPIFY_API_VERSION', { infer: true }) || SHOPIFY_API_VERSION_DEFAULT;
  }

  /** Resolve the connection from an explicit shopDomain (Integration) + env token. */
  connection(shopDomain?: string | null): ShopifyConn | null {
    const domain = shopDomain || this.config.get('SHOPIFY_SHOP_DOMAIN', { infer: true });
    const accessToken = this.config.get('SHOPIFY_ADMIN_ACCESS_TOKEN', { infer: true });
    if (!domain || !accessToken) return null;
    return { shopDomain: domain, accessToken, apiVersion: this.apiVersion() };
  }

  /** Cheap credential check — returns the shop or throws a readable reason. */
  async getShop(conn: ShopifyConn): Promise<{ name: string; domain: string }> {
    const { json } = await this.request(conn, 'shop.json');
    const shop = (json as { shop?: { name?: string; domain?: string } }).shop;
    if (!shop) throw new Error('Shopify returned no shop — check the access token');
    return { name: shop.name ?? conn.shopDomain, domain: shop.domain ?? conn.shopDomain };
  }

  /** Order count (status=any), optionally since a timestamp. */
  async orderCount(conn: ShopifyConn, opts: { updatedAtMin?: string } = {}): Promise<number> {
    const params = new URLSearchParams({ status: 'any' });
    if (opts.updatedAtMin) params.set('updated_at_min', opts.updatedAtMin);
    const { json } = await this.request(conn, `orders/count.json?${params.toString()}`);
    return Number((json as { count?: number }).count ?? 0);
  }

  /**
   * Cursor-paginate a resource (customers/products/orders), invoking `onBatch`
   * per page until exhausted. Honors the REST Link header page_info cursor.
   */
  async paginate(
    conn: ShopifyConn,
    resource: 'customers' | 'products' | 'orders',
    query: Record<string, string>,
    onBatch: (items: Record<string, unknown>[]) => Promise<void>,
  ): Promise<number> {
    let path = `${resource}.json?${new URLSearchParams({ limit: '250', ...query }).toString()}`;
    let count = 0;
    for (let page = 0; page < 100_000; page++) {
      const { json, nextPageInfo } = await this.request(conn, path);
      const items = ((json as Record<string, unknown>)[resource] as Record<string, unknown>[]) ?? [];
      if (items.length) {
        await onBatch(items);
        count += items.length;
      }
      if (!nextPageInfo) break;
      path = `${resource}.json?${new URLSearchParams({ limit: '250', page_info: nextPageInfo }).toString()}`;
    }
    return count;
  }

  // ----- HTTP with 429 backoff -------------------------------------------
  private async request(
    conn: ShopifyConn,
    path: string,
  ): Promise<{ json: unknown; nextPageInfo: string | null }> {
    const url = `https://${conn.shopDomain}/admin/api/${conn.apiVersion}/${path}`;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': conn.accessToken, 'Content-Type': 'application/json' } });

      if (res.status === 429 || res.status >= 500) {
        if (attempt === MAX_RETRIES) throw new Error(`Shopify ${res.status} after ${MAX_RETRIES} retries`);
        const retryAfter = Number(res.headers.get('retry-after'));
        const backoff = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(30_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250); // exponential + jitter
        this.logger.warn(`Shopify ${res.status} — backing off ${backoff}ms (attempt ${attempt + 1})`);
        await sleep(backoff);
        continue;
      }
      if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text().catch(() => '')}`);

      return { json: await res.json(), nextPageInfo: parseNextPageInfo(res.headers.get('link')) };
    }
    throw new Error('Shopify request exhausted retries');
  }
}

/** Extract the page_info cursor of the rel="next" Link header entry. */
export function parseNextPageInfo(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(',')) {
    if (!/rel="next"/.test(part)) continue;
    const m = part.match(/[?&]page_info=([^&>]+)/);
    if (m) return decodeURIComponent(m[1]);
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
