/**
 * Framework-free test for the shared web API client's token freshness + 401
 * refresh/retry behavior. Run with: `npx tsx src/lib/api.retry.test.ts`.
 *
 * Asserts:
 *  - a 401 triggers exactly ONE silent refresh (getToken({skipCache:true})) + retry, then succeeds;
 *  - a persistent 401 throws ApiAuthError after exactly one retry;
 *  - a null token (signed out) throws ApiAuthError without hitting the network.
 */
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_API_URL = 'http://test.local';

type FetchCall = { url: string; auth: string | undefined };
let fetchCalls: FetchCall[] = [];

function installFetch(statuses: number[]): void {
  fetchCalls = [];
  let i = 0;
  // @ts-expect-error - override the global for the test
  global.fetch = async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    fetchCalls.push({ url: String(url), auth: headers.Authorization });
    const status = statuses[Math.min(i, statuses.length - 1)];
    i += 1;
    if (status === 200) {
      return new Response(JSON.stringify({ data: [], nextCursor: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ message: 'Invalid or expired token' }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
}

/** getToken that returns a distinct token per skipCache so we can prove a refresh. */
function makeGetToken(value: string | null) {
  const seen: Array<{ skipCache?: boolean }> = [];
  const getToken = async (opts?: { skipCache?: boolean }) => {
    seen.push(opts ?? {});
    if (value === null) return null;
    return opts?.skipCache ? `${value}-fresh` : `${value}-stale`;
  };
  return { getToken, seen };
}

/** Make the next fetch reject like a real network/CORS failure (no response). */
function installFailingFetch(): void {
  fetchCalls = [];
  // @ts-expect-error - override the global for the test
  global.fetch = async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    fetchCalls.push({ url: String(url), auth: headers.Authorization });
    throw new TypeError('Failed to fetch');
  };
}

async function main(): Promise<void> {
  const { listContacts, ApiAuthError, ApiNetworkError } = await import('./api');

  // 1) 401 → refresh + retry once → success.
  installFetch([401, 200]);
  {
    const { getToken } = makeGetToken('tok');
    const res = await listContacts(getToken, {});
    assert.deepEqual(res, { data: [], nextCursor: null }, 'resolves after retry');
    assert.equal(fetchCalls.length, 2, 'exactly one retry (2 fetches)');
    assert.equal(fetchCalls[0].auth, 'Bearer tok-stale', 'first uses cached token');
    assert.equal(fetchCalls[1].auth, 'Bearer tok-fresh', 'retry uses skipCache-refreshed token');
  }

  // 2) persistent 401 → ApiAuthError after exactly one retry.
  installFetch([401, 401]);
  {
    const { getToken } = makeGetToken('tok');
    await assert.rejects(() => listContacts(getToken, {}), (e) => e instanceof ApiAuthError, 'throws ApiAuthError');
    assert.equal(fetchCalls.length, 2, 'retries exactly once then gives up');
  }

  // 3) signed out (null token) → ApiAuthError, no network call.
  installFetch([200]);
  {
    const { getToken } = makeGetToken(null);
    await assert.rejects(() => listContacts(getToken, {}), (e) => e instanceof ApiAuthError, 'throws ApiAuthError');
    assert.equal(fetchCalls.length, 0, 'no fetch when there is no token');
  }

  // 4) network/CORS failure (fetch rejects) → ApiNetworkError, distinct from ApiAuthError.
  installFailingFetch();
  {
    const { getToken } = makeGetToken('tok');
    await assert.rejects(
      () => listContacts(getToken, {}),
      (e) => e instanceof ApiNetworkError && !(e instanceof ApiAuthError),
      'throws ApiNetworkError when the request never completes',
    );
    assert.equal(fetchCalls.length, 1, 'no retry on a network error');
  }

  console.log('api.retry: OK');
}

main().catch((err) => {
  console.error('api.retry: FAILED');
  console.error(err);
  process.exit(1);
});
