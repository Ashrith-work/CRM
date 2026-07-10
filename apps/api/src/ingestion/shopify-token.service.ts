import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { RedisService } from '../redis/redis.service';
import { CryptoService } from '../common/crypto.service';

/** Actionable classification of a token-acquisition failure. */
export type ShopifyTokenErrorCode =
  | 'not_configured'
  | 'shop_not_permitted'
  | 'invalid_client'
  | 'token_request_failed';

/**
 * Thrown when a Shopify access token cannot be obtained. The message is safe to
 * surface (never contains the token); `code` lets callers react (e.g. mark the
 * Integration degraded on `shop_not_permitted` / `invalid_client`).
 */
export class ShopifyTokenError extends Error {
  constructor(
    message: string,
    readonly code: ShopifyTokenErrorCode,
  ) {
    super(message);
    this.name = 'ShopifyTokenError';
  }
}

interface CachedToken {
  token: string;
  /** Epoch ms at which the token hard-expires. */
  expiresAt: number;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

/** Refresh this long BEFORE hard expiry (Shopify client-credentials tokens ~24h). */
const SAFETY_MARGIN_MS = 60 * 60 * 1000; // 1h
/** Assumed lifetime when Shopify omits `expires_in`. */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_FETCH_RETRIES = 3;
const CACHE_PREFIX = 'shopify:token:';

/**
 * Obtains + caches Shopify Admin API access tokens via the CLIENT-CREDENTIALS
 * grant (post-Jan-2026 Dev Dashboard apps — there is no pasted admin token).
 *
 *  - `getToken()` returns a valid token, fetching a new one only when the cache
 *    is empty, within the safety margin of expiry, or `forceRefresh` is set.
 *  - Tokens are cached in the SHARED Redis cache (encrypted at rest) keyed per
 *    shop, so every API instance/worker reuses one token; an in-memory copy is
 *    the single-instance fallback.
 *  - Concurrent callers on an expired token trigger exactly ONE fetch
 *    (single-flight), never one per caller.
 *  - The token is NEVER logged.
 */
@Injectable()
export class ShopifyTokenService {
  private readonly logger = new Logger(ShopifyTokenService.name);
  /** Per-instance fallback cache + single-flight de-dup, keyed by shop domain. */
  private readonly memory = new Map<string, CachedToken>();
  private readonly inflight = new Map<string, Promise<string>>();

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly redis: RedisService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Return a valid access token for `shopDomain` (defaults to SHOPIFY_SHOP_DOMAIN).
   * Pass `{ forceRefresh: true }` from the reactive 401 path to bypass the cache.
   */
  async getToken(shopDomain?: string, opts: { forceRefresh?: boolean } = {}): Promise<string> {
    const domain = (shopDomain || this.config.get('SHOPIFY_SHOP_DOMAIN', { infer: true }))?.trim();
    if (!domain) throw new ShopifyTokenError('SHOPIFY_SHOP_DOMAIN is not configured', 'not_configured');

    if (!opts.forceRefresh) {
      const cached = await this.read(domain);
      if (cached && cached.expiresAt - Date.now() > SAFETY_MARGIN_MS) return cached.token;
    }

    // Single-flight: coalesce every concurrent fetch for this shop into one.
    let flight = this.inflight.get(domain);
    if (!flight) {
      flight = this.fetchAndCache(domain).finally(() => this.inflight.delete(domain));
      this.inflight.set(domain, flight);
    }
    return flight;
  }

  /** Forget any cached token for the shop (ops/test hook). */
  async invalidate(shopDomain?: string): Promise<void> {
    const domain = (shopDomain || this.config.get('SHOPIFY_SHOP_DOMAIN', { infer: true }))?.trim();
    if (!domain) return;
    this.memory.delete(domain);
    await this.redis.cacheSet(CACHE_PREFIX + domain, null, 1);
  }

  // ---- internals ----------------------------------------------------------
  private async fetchAndCache(domain: string): Promise<string> {
    const clientId = this.config.get('SHOPIFY_API_KEY', { infer: true });
    const clientSecret = this.config.get('SHOPIFY_API_SECRET', { infer: true });
    if (!clientId || !clientSecret) {
      throw new ShopifyTokenError('SHOPIFY_API_KEY / SHOPIFY_API_SECRET are not configured', 'not_configured');
    }

    const body = await this.requestWithBackoff(domain, clientId, clientSecret);
    const token = body.access_token;
    if (!token) throw new ShopifyTokenError('Shopify token response contained no access_token', 'token_request_failed');

    const ttlMs = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in * 1000 : DEFAULT_TTL_MS;
    const expiresAt = Date.now() + ttlMs;
    await this.write(domain, { token, expiresAt });
    // Log the LIFETIME, never the token.
    this.logger.log(`Obtained Shopify token for ${domain} (valid ~${Math.round(ttlMs / 3_600_000)}h)`);
    return token;
  }

  /** POST the client-credentials grant; retry transient (network / 429 / 5xx). */
  private async requestWithBackoff(domain: string, clientId: string, clientSecret: string): Promise<TokenResponse> {
    const url = `https://${domain}/admin/oauth/access_token`;
    let lastErr: Error | null = null;

    for (let attempt = 0; attempt <= MAX_FETCH_RETRIES; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
        });

        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`token endpoint ${res.status}`);
          if (attempt < MAX_FETCH_RETRIES) {
            await sleep(backoff(attempt));
            continue;
          }
          throw new ShopifyTokenError(`Shopify token endpoint failed (${res.status}) after ${MAX_FETCH_RETRIES} retries`, 'token_request_failed');
        }

        const parsed = (await res.json().catch(() => ({}))) as TokenResponse;
        if (!res.ok) throw classify(res.status, parsed);
        return parsed;
      } catch (err) {
        if (err instanceof ShopifyTokenError) throw err; // non-retryable (auth/misconfig)
        lastErr = err as Error; // network error → retry
        if (attempt < MAX_FETCH_RETRIES) {
          await sleep(backoff(attempt));
          continue;
        }
        throw new ShopifyTokenError(`Shopify token request failed: ${lastErr.message}`, 'token_request_failed');
      }
    }
    throw new ShopifyTokenError(`Shopify token request exhausted retries: ${lastErr?.message ?? 'unknown'}`, 'token_request_failed');
  }

  private async read(domain: string): Promise<CachedToken | null> {
    // Shared (encrypted) cache first, then the per-instance fallback.
    try {
      const cached = await this.redis.cacheGet<{ t: string; e: number }>(CACHE_PREFIX + domain);
      if (cached?.t) {
        const token = this.crypto.decryptField(cached.t);
        if (token) return { token, expiresAt: cached.e };
      }
    } catch (err) {
      this.logger.warn(`Shopify token cache read failed (${(err as Error).message}) — using fallback`);
    }
    return this.memory.get(domain) ?? null;
  }

  private async write(domain: string, value: CachedToken): Promise<void> {
    this.memory.set(domain, value);
    const ttlSeconds = Math.max(60, Math.floor((value.expiresAt - Date.now()) / 1000));
    // Encrypt before it rests in Redis; never persist the token in the clear.
    const enc = this.crypto.encryptField(value.token);
    if (enc) await this.redis.cacheSet(CACHE_PREFIX + domain, { t: enc, e: value.expiresAt }, ttlSeconds);
  }
}

/** Map a 4xx token error to an actionable ShopifyTokenError. */
function classify(status: number, body: TokenResponse): ShopifyTokenError {
  const reason = body.error_description || body.error || `HTTP ${status}`;
  const raw = `${body.error ?? ''} ${body.error_description ?? ''}`.toLowerCase();
  if (raw.includes('shop_not_permitted') || raw.includes('not permitted')) {
    return new ShopifyTokenError(
      "shop_not_permitted: client-credentials requires the app and store in the SAME organization. Move/install the app into this store's organization, then retry.",
      'shop_not_permitted',
    );
  }
  if (status === 401 || raw.includes('invalid_client') || raw.includes('invalid_request')) {
    return new ShopifyTokenError(`invalid_client: verify SHOPIFY_API_KEY / SHOPIFY_API_SECRET (${reason})`, 'invalid_client');
  }
  return new ShopifyTokenError(`Shopify token request rejected: ${reason}`, 'token_request_failed');
}

function backoff(attempt: number): number {
  return Math.min(8_000, 250 * 2 ** attempt);
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
