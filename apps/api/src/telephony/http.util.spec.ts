import { backoff, fetchWithResilience, TelephonyAuthError, TelephonyConfigError } from './http.util';

/** A minimal fake Response (only the fields fetchWithResilience reads). */
function res(status: number): Response {
  return { ok: status >= 200 && status < 300, status } as Response;
}

const noSleep = async () => {};
const zeroJitter = () => 0;
const base = { sleep: noSleep, random: zeroJitter } as const;

describe('fetchWithResilience (self-healing HTTP)', () => {
  it('retries a transient 5xx and then succeeds', async () => {
    const thunk = jest.fn<Promise<Response>, []>()
      .mockResolvedValueOnce(res(503))
      .mockResolvedValueOnce(res(200));
    const out = await fetchWithResilience(thunk, base);
    expect(out.status).toBe(200);
    expect(thunk).toHaveBeenCalledTimes(2);
  });

  it('retries a network error and then succeeds', async () => {
    const thunk = jest.fn<Promise<Response>, []>()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(res(200));
    const out = await fetchWithResilience(thunk, base);
    expect(out.status).toBe(200);
    expect(thunk).toHaveBeenCalledTimes(2);
  });

  it('retries 429 (rate-limit) as transient', async () => {
    const thunk = jest.fn<Promise<Response>, []>()
      .mockResolvedValueOnce(res(429))
      .mockResolvedValueOnce(res(200));
    await expect(fetchWithResilience(thunk, base)).resolves.toMatchObject({ status: 200 });
    expect(thunk).toHaveBeenCalledTimes(2);
  });

  it('refreshes auth ONCE on 401 then retries and succeeds', async () => {
    const thunk = jest.fn<Promise<Response>, []>()
      .mockResolvedValueOnce(res(401))
      .mockResolvedValueOnce(res(200));
    const refreshAuth = jest.fn();
    const out = await fetchWithResilience(thunk, { ...base, refreshAuth });
    expect(out.status).toBe(200);
    expect(refreshAuth).toHaveBeenCalledTimes(1);
    expect(thunk).toHaveBeenCalledTimes(2);
  });

  it('throws TelephonyAuthError when auth still fails after the single refresh', async () => {
    const thunk = jest.fn<Promise<Response>, []>().mockResolvedValue(res(401));
    const refreshAuth = jest.fn();
    await expect(fetchWithResilience(thunk, { ...base, refreshAuth })).rejects.toBeInstanceOf(TelephonyAuthError);
    expect(refreshAuth).toHaveBeenCalledTimes(1); // refreshed exactly once, not looped
  });

  it('throws TelephonyConfigError on a 4xx and does NOT retry', async () => {
    const thunk = jest.fn<Promise<Response>, []>().mockResolvedValue(res(400));
    await expect(fetchWithResilience(thunk, base)).rejects.toBeInstanceOf(TelephonyConfigError);
    expect(thunk).toHaveBeenCalledTimes(1);
  });

  it('gives up after `retries` transient attempts', async () => {
    const thunk = jest.fn<Promise<Response>, []>().mockResolvedValue(res(500));
    await expect(fetchWithResilience(thunk, { ...base, retries: 3 })).rejects.toBeInstanceOf(TelephonyConfigError);
    expect(thunk).toHaveBeenCalledTimes(3);
  });
});

describe('backoff', () => {
  it('grows exponentially, is capped, and stays within the jitter band', () => {
    // random=1 → full band (exp * 1.0); random=0 → half band (exp * 0.5).
    expect(backoff(0, 300, 10_000, () => 1)).toBe(300);
    expect(backoff(1, 300, 10_000, () => 1)).toBe(600);
    expect(backoff(2, 300, 10_000, () => 0)).toBe(600); // exp=1200, half = 600
    expect(backoff(20, 300, 10_000, () => 1)).toBe(10_000); // capped
  });
});
