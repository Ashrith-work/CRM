/**
 * Framework-free test for the shared API client's fresh-token + 401
 * refresh/retry behavior. Run with:  npx tsx apps/mobile/src/api.retry.test.ts
 * Stubs global.fetch + a fake getToken (no network, no Clerk).
 */
import assert from 'node:assert/strict';

process.env.EXPO_PUBLIC_API_URL = 'http://test.local';

type FetchImpl = (input: unknown, init?: unknown) => Promise<unknown>;
const setFetch = (impl: FetchImpl): void => {
  (globalThis as unknown as { fetch: unknown }).fetch = impl as unknown;
};
const ok200 = { ok: true, status: 200, json: async () => ({ data: [], nextCursor: null }) };
const unauthorized = { ok: false, status: 401, json: async () => ({ message: 'Invalid or expired token' }) };

async function main(): Promise<void> {
  const { listContacts, ApiAuthError } = await import('./api');

  // 1) 401 then 200 → refresh with skipCache + retry once, then succeed.
  {
    let calls = 0;
    const skipCacheFlags: Array<boolean | undefined> = [];
    setFetch(async () => (++calls === 1 ? unauthorized : ok200));
    const getToken = async (opts?: { skipCache?: boolean }) => {
      skipCacheFlags.push(opts?.skipCache);
      return 'tok';
    };
    const res = await listContacts(getToken, {});
    assert.equal(calls, 2, 'expected exactly one retry (2 fetches)');
    assert.equal(skipCacheFlags[0], undefined, 'first attempt uses the cached token');
    assert.equal(skipCacheFlags[1], true, 'retry forces a fresh token (skipCache: true)');
    assert.deepEqual(res.data, [], 'resolves with the 200 body');
  }

  // 2) persistent 401 (both attempts) → ApiAuthError, no further retries.
  {
    let calls = 0;
    setFetch(async () => {
      calls++;
      return unauthorized;
    });
    await assert.rejects(
      listContacts(async () => 'tok', {}),
      (e) => e instanceof ApiAuthError,
      'persistent 401 must surface ApiAuthError',
    );
    assert.equal(calls, 2, 'exactly one retry even when it keeps failing');
  }

  // 3) no token available → ApiAuthError before any fetch.
  {
    let calls = 0;
    setFetch(async () => {
      calls++;
      return ok200;
    });
    await assert.rejects(
      listContacts(async () => null, {}),
      (e) => e instanceof ApiAuthError,
      'null token must surface ApiAuthError',
    );
    assert.equal(calls, 0, 'no request is made without a token');
  }

  console.log('api.retry: OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
