import { parseNextPageInfo, ShopifyService, type ShopifyConn } from './shopify.service';
import type { ShopifyTokenService } from './shopify-token.service';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';

const conn: ShopifyConn = { shopDomain: 'nerige.myshopify.com', apiVersion: '2024-10' };

function res(status: number, opts: { items?: unknown[]; link?: string | null; retryAfter?: string; body?: string } = {}) {
  return {
    status,
    ok: status < 400,
    headers: {
      get: (k: string) => (k === 'link' ? opts.link ?? null : k === 'retry-after' ? opts.retryAfter ?? null : null),
    },
    json: async () => (opts.items ? { orders: opts.items } : {}),
    text: async () => opts.body ?? '',
  } as unknown as Response;
}

function service(token?: Partial<ShopifyTokenService>): ShopifyService {
  const tok = { getToken: jest.fn().mockResolvedValue('tok'), ...token } as unknown as ShopifyTokenService;
  return new ShopifyService({ get: jest.fn() } as unknown as ConfigService<Env, true>, tok);
}

describe('parseNextPageInfo', () => {
  it('extracts the rel="next" page_info cursor', () => {
    const link = '<https://x/admin/api/2024-10/orders.json?limit=250&page_info=abc123>; rel="next"';
    expect(parseNextPageInfo(link)).toBe('abc123');
  });
  it('returns null for no link / only a previous link', () => {
    expect(parseNextPageInfo(null)).toBeNull();
    expect(parseNextPageInfo('<https://x?page_info=zzz>; rel="previous"')).toBeNull();
  });
});

describe('ShopifyService.paginate', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('follows the page_info cursor to exhaustion', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(res(200, { items: [{ id: 1 }, { id: 2 }], link: '<https://x?page_info=next1>; rel="next"' }))
      .mockResolvedValueOnce(res(200, { items: [{ id: 3 }], link: null }));

    const seen: unknown[] = [];
    const total = await service().paginate(conn, 'orders', {}, async (items) => {
      seen.push(...items);
    });

    expect(total).toBe(3);
    expect(seen).toHaveLength(3);
    expect((global.fetch as jest.Mock)).toHaveBeenCalledTimes(2);
  });

  it('backs off on 429 and resumes', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(res(429)) // rate limited → back off
      .mockResolvedValueOnce(res(200, { items: [{ id: 1 }], link: null }));

    const seen: unknown[] = [];
    const total = await service().paginate(conn, 'orders', {}, async (items) => {
      seen.push(...items);
    });

    expect(total).toBe(1);
    expect(seen).toEqual([{ id: 1 }]);
    expect((global.fetch as jest.Mock)).toHaveBeenCalledTimes(2); // retried after backoff
  }, 15_000);

  it('retries a transient 403 "Unavailable Shop" and resumes', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(res(403, { body: '{"errors":"Unavailable Shop"}' })) // transient → back off + retry
      .mockResolvedValueOnce(res(200, { items: [{ id: 1 }], link: null }));

    const seen: unknown[] = [];
    const total = await service().paginate(conn, 'orders', {}, async (items) => {
      seen.push(...items);
    });

    expect(total).toBe(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  }, 15_000);

  it('does NOT retry a permanent 403 (e.g. missing scope) — throws immediately', async () => {
    global.fetch = jest.fn().mockResolvedValue(res(403, { body: '{"errors":"requires merchant approval for write_price_rules scope"}' }));

    await expect(service().paginate(conn, 'orders', {}, async () => {})).rejects.toThrow(/403/);
    expect(global.fetch).toHaveBeenCalledTimes(1); // no retry on a permanent error
  });

  it('reactively refreshes the token on 401 and retries the request once', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(res(401)) // stale token → refresh + retry
      .mockResolvedValueOnce(res(200, { items: [{ id: 1 }], link: null }));
    const getToken = jest
      .fn()
      .mockResolvedValueOnce('stale-token') // initial
      .mockResolvedValueOnce('fresh-token'); // forceRefresh

    const seen: unknown[] = [];
    const total = await service({ getToken } as never).paginate(conn, 'orders', {}, async (items) => {
      seen.push(...items);
    });

    expect(total).toBe(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    // Exactly one refresh, and it was a forced one.
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(getToken).toHaveBeenNthCalledWith(2, conn.shopDomain, { forceRefresh: true });
    // The retry used the fresh token in the header.
    const secondHeaders = (global.fetch as jest.Mock).mock.calls[1][1].headers;
    expect(secondHeaders['X-Shopify-Access-Token']).toBe('fresh-token');
  });
});
