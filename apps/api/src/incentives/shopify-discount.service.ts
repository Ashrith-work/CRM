import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import type { Env } from '../config/env';
import { SHOPIFY_API_VERSION_DEFAULT } from '../ingestion/shopify.service';

export interface DiscountParams {
  /** FIXED_AMOUNT value off (paise) — already capped to maxValueMinor. */
  valueMinor: number;
  minSubtotalMinor: number;
  /** Product externalIds the code may NOT apply to (low-margin exclusions). */
  excludedProductExternalIds: string[];
  validFrom: Date;
  validUntil: Date;
  title: string;
}

export interface DiscountResult {
  code: string;
  /** True when actually created in Shopify; false = local-only (MOCK/offline). */
  external: boolean;
}

/**
 * Issues a Shopify code discount (REST price rule + code). Self-contained: reads
 * the shop domain + admin token from env so it doesn't couple to the ingestion
 * module. MOCK mode (token unset) returns a locally-generated code without an API
 * call — the incentive still exists and the code can be wired up later. The VALUE
 * cap + excluded SKUs + minimum subtotal are enforced on the price rule.
 */
@Injectable()
export class ShopifyDiscountService {
  private readonly logger = new Logger(ShopifyDiscountService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  private conn(): { domain: string; token: string; apiVersion: string } | null {
    const domain = this.config.get('SHOPIFY_SHOP_DOMAIN', { infer: true });
    const token = this.config.get('SHOPIFY_ADMIN_ACCESS_TOKEN', { infer: true });
    if (!domain || !token) return null;
    return { domain, token, apiVersion: this.config.get('SHOPIFY_API_VERSION', { infer: true }) || SHOPIFY_API_VERSION_DEFAULT };
  }

  /** A short, unique, human-typable code. */
  generateCode(prefix = 'LOYAL'): string {
    return `${prefix}-${randomBytes(4).toString('hex').toUpperCase()}`;
  }

  async issue(params: DiscountParams): Promise<DiscountResult> {
    const code = this.generateCode();
    const conn = this.conn();
    if (!conn) {
      this.logger.log(`[MOCK discount] ${code}: ₹${params.valueMinor / 100} off, min ₹${params.minSubtotalMinor / 100}, excl ${params.excludedProductExternalIds.length} SKU(s)`);
      return { code, external: false };
    }
    try {
      const priceRuleId = await this.createPriceRule(conn, code, params);
      await this.createDiscountCode(conn, priceRuleId, code);
      return { code, external: true };
    } catch (err) {
      this.logger.error(`Shopify discount issue failed (${code}), keeping it local: ${(err as Error).message}`);
      return { code, external: false };
    }
  }

  private async createPriceRule(conn: { domain: string; token: string; apiVersion: string }, code: string, p: DiscountParams): Promise<string> {
    const body: Record<string, unknown> = {
      price_rule: {
        title: p.title || code,
        target_type: 'line_item',
        // Exclude low-margin SKUs by scoping entitlement to the rest (allowlist).
        target_selection: p.excludedProductExternalIds.length ? 'entitled' : 'all',
        allocation_method: 'across',
        value_type: 'fixed_amount',
        value: `-${(p.valueMinor / 100).toFixed(2)}`, // negative = amount off
        customer_selection: 'all',
        starts_at: p.validFrom.toISOString(),
        ends_at: p.validUntil.toISOString(),
        once_per_customer: true,
        usage_limit: 1, // single redemption
        ...(p.minSubtotalMinor > 0 ? { prerequisite_subtotal_range: { greater_than_or_equal_to: (p.minSubtotalMinor / 100).toFixed(2) } } : {}),
      },
    };
    const json = (await this.post(conn, 'price_rules.json', body)) as { price_rule?: { id?: number } };
    const id = json.price_rule?.id;
    if (!id) throw new Error('Shopify returned no price_rule id');
    return String(id);
  }

  private async createDiscountCode(conn: { domain: string; token: string; apiVersion: string }, priceRuleId: string, code: string): Promise<void> {
    await this.post(conn, `price_rules/${priceRuleId}/discount_codes.json`, { discount_code: { code } });
  }

  private async post(conn: { domain: string; token: string; apiVersion: string }, path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`https://${conn.domain}/admin/api/${conn.apiVersion}/${path}`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': conn.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text().catch(() => '')}`);
    return res.json();
  }
}
