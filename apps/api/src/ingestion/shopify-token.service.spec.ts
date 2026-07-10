import { ShopifyTokenService, ShopifyTokenError } from './shopify-token.service';
import { CryptoService } from '../common/crypto.service';
import { makeTestConfig } from '../common/crypto.testkit';
import type { RedisService } from '../redis/redis.service';

/**
 * ShopifyTokenService: client-credentials fetch + shared/encrypted cache +
 * proactive & (via ShopifyService) reactive refresh + single-flight. The token
 * endpoint (global.fetch) is mocked; the cache is a real Map-backed RedisService
 * stand-in and a REAL CryptoService, so the encrypt-on-write / decrypt-on-read
 * path is exercised for real.
 */
const CONFIG = makeTestConfig({
  SHOPIFY_SHOP_DOMAIN: 'nerige.myshopify.com',
  SHOPIFY_API_KEY: 'client-id-123',
  SHOPIFY_API_SECRET: 'client-secret-456',
});

function tokenRes(status: number, body: unknown) {
  return { status, ok: status < 400, json: async () => body } as unknown as Response;
}

function makeRedis() {
  const store = new Map<string, unknown>();
  const redis = {
    cacheGet: jest.fn(async (k: string) => (store.has(k) ? store.get(k) : null)),
    cacheSet: jest.fn(async (k: string, v: unknown) => {
      if (v === null) store.delete(k);
      else store.set(k, v);
    }),
  } as unknown as RedisService;
  return { redis, store };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('ShopifyTokenService', () => {
  const realFetch = global.fetch;
  let svc: ShopifyTokenService;
  let store: Map<string, unknown>;

  beforeEach(() => {
    const crypto = new CryptoService(CONFIG);
    const r = makeRedis();
    store = r.store;
    svc = new ShopifyTokenService(CONFIG, r.redis, crypto);
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('fetches a token via the client-credentials grant and caches it (encrypted)', async () => {
    global.fetch = jest.fn().mockResolvedValue(tokenRes(200, { access_token: 'tkn_1', expires_in: 86399 }));

    const token = await svc.getToken();

    expect(token).toBe('tkn_1');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    // POSTed the grant to the right endpoint with grant_type=client_credentials.
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://nerige.myshopify.com/admin/oauth/access_token');
    expect(JSON.parse(init.body)).toMatchObject({ grant_type: 'client_credentials', client_id: 'client-id-123' });
    // Cached in Redis, and the raw token is NOT stored in the clear.
    const cached = store.get('shopify:token:nerige.myshopify.com') as { t: string };
    expect(cached).toBeDefined();
    expect(JSON.stringify(cached)).not.toContain('tkn_1');
  });

  it('reuses the cached token — a second call within validity does NOT hit the endpoint', async () => {
    global.fetch = jest.fn().mockResolvedValue(tokenRes(200, { access_token: 'tkn_1', expires_in: 86399 }));

    expect(await svc.getToken()).toBe('tkn_1');
    expect(await svc.getToken()).toBe('tkn_1');

    expect(global.fetch).toHaveBeenCalledTimes(1); // reused, not refetched
  });

  it('proactively refreshes when the cached token is within the safety margin of expiry', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(tokenRes(200, { access_token: 'tkn_short', expires_in: 60 })) // ~expired for our margin
      .mockResolvedValueOnce(tokenRes(200, { access_token: 'tkn_new', expires_in: 86399 }));

    expect(await svc.getToken()).toBe('tkn_short'); // fetch #1
    expect(await svc.getToken()).toBe('tkn_new'); // within margin → fetch #2

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('single-flight: many concurrent callers on an empty cache trigger exactly ONE fetch', async () => {
    global.fetch = jest.fn().mockImplementation(async () => {
      await sleep(15); // hold the fetch so all callers pile up first
      return tokenRes(200, { access_token: 'tkn_sf', expires_in: 86399 });
    });

    const results = await Promise.all([svc.getToken(), svc.getToken(), svc.getToken(), svc.getToken(), svc.getToken()]);

    expect(results).toEqual(['tkn_sf', 'tkn_sf', 'tkn_sf', 'tkn_sf', 'tkn_sf']);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('shop_not_permitted → a clear ShopifyTokenError with the actionable code, no crash', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(tokenRes(403, { error: 'shop_not_permitted', error_description: 'app not in shop org' }));

    await expect(svc.getToken()).rejects.toBeInstanceOf(ShopifyTokenError);
    await expect(svc.getToken()).rejects.toMatchObject({ code: 'shop_not_permitted' });
    await expect(svc.getToken()).rejects.toThrow(/shop_not_permitted/i);
  });

  it('bad credentials → invalid_client error code', async () => {
    global.fetch = jest.fn().mockResolvedValue(tokenRes(401, { error: 'invalid_client' }));
    await expect(svc.getToken()).rejects.toMatchObject({ code: 'invalid_client' });
  });
});
