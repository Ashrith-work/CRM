import { parseNextPageInfo, ShopifyService, type ShopifyConn } from './shopify.service';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';

const conn: ShopifyConn = { shopDomain: 'nerige.myshopify.com', accessToken: 'tok', apiVersion: '2024-10' };

function res(status: number, opts: { items?: unknown[]; link?: string | null; retryAfter?: string } = {}) {
  return {
    status,
    ok: status < 400,
    headers: {
      get: (k: string) => (k === 'link' ? opts.link ?? null : k === 'retry-after' ? opts.retryAfter ?? null : null),
    },
    json: async () => (opts.items ? { orders: opts.items } : {}),
    text: async () => '',
  } as unknown as Response;
}

function service(): ShopifyService {
  return new ShopifyService({ get: jest.fn() } as unknown as ConfigService<Env, true>);
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
});
