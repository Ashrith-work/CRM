/**
 * Self-healing HTTP for telephony provider calls (the "sort itself out" layer).
 *
 * RECOVERABLE failures auto-fix with no human: transient network errors, 429, and
 * 5xx are retried with exponential backoff + jitter; an expired/invalid auth token
 * (401/403) triggers a single `refreshAuth()` then one more attempt.
 *
 * UN-RECOVERABLE failures are classified and surfaced (never swallowed): auth that
 * survives a refresh → `TelephonyAuthError`; a config/permission 4xx (400/403 after
 * refresh/404/422) → `TelephonyConfigError`. The caller flips the Integration to an
 * error status with the reason (see TelephonyStatusService).
 */

/** Auth failed even after a refresh — needs a human (bad/rotated API key). */
export class TelephonyAuthError extends Error {
  readonly kind = 'auth_error' as const;
  constructor(message: string) {
    super(message);
    this.name = 'TelephonyAuthError';
  }
}

/** Request is malformed/not permitted — needs a human (misconfig, bad number/DID). */
export class TelephonyConfigError extends Error {
  readonly kind = 'config_error' as const;
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'TelephonyConfigError';
  }
}

export interface ResilienceOptions {
  /** Total attempts for transient failures (network/429/5xx). Default 4. */
  retries?: number;
  /** Base backoff (ms) — doubles each attempt, plus jitter. Default 300. */
  baseDelayMs?: number;
  /** Cap on any single backoff wait (ms). Default 10_000. */
  maxDelayMs?: number;
  /** Called ONCE when a 401/403 is seen, before the single auth retry. */
  refreshAuth?: () => Promise<void> | void;
  /** Injected sleep (tests pass a no-op / fake timer). Default real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected RNG in [0,1) for jitter (tests pass a fixed value). Default Math.random. */
  random?: () => number;
  /** Label for error messages / logs. */
  label?: string;
}

const TRANSIENT_STATUS = (s: number): boolean => s === 429 || s >= 500;
const AUTH_STATUS = (s: number): boolean => s === 401 || s === 403;
const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Run `thunk` (which performs one fetch and returns its Response) with the
 * self-healing policy above. Returns the first successful (`res.ok`) Response.
 * `thunk` receiving a fresh call each attempt lets `refreshAuth` swap credentials
 * in between. Throws TelephonyAuthError / TelephonyConfigError for un-recoverable
 * cases, and the last transient error once retries are exhausted.
 */
export async function fetchWithResilience(
  thunk: () => Promise<Response>,
  opts: ResilienceOptions = {},
): Promise<Response> {
  const retries = opts.retries ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 300;
  const maxDelayMs = opts.maxDelayMs ?? 10_000;
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  const label = opts.label ?? 'telephony request';

  let refreshed = false;
  let transientAttempt = 0;
  let lastErr: unknown;

  // Loop is bounded by `retries` transient attempts + at most one extra auth retry.
  for (;;) {
    let res: Response;
    try {
      res = await thunk();
    } catch (err) {
      // Network-level failure (DNS, ECONNRESET, fetch throw) — transient.
      lastErr = err;
      if (transientAttempt + 1 >= retries) {
        throw new Error(`${label} failed after ${retries} attempts: ${(err as Error).message}`);
      }
      await sleep(backoff(transientAttempt++, baseDelayMs, maxDelayMs, random));
      continue;
    }

    if (res.ok) return res;

    if (AUTH_STATUS(res.status)) {
      // Expired/invalid token: refresh ONCE and retry once. If it still fails,
      // it's un-recoverable — surface it.
      if (!refreshed && opts.refreshAuth) {
        refreshed = true;
        await opts.refreshAuth();
        continue;
      }
      throw new TelephonyAuthError(`${label}: authentication failed (${res.status})`);
    }

    if (TRANSIENT_STATUS(res.status)) {
      lastErr = new Error(`${label}: ${res.status}`);
      if (transientAttempt + 1 >= retries) {
        throw new TelephonyConfigError(`${label} failed after ${retries} attempts (last status ${res.status})`, res.status);
      }
      await sleep(backoff(transientAttempt++, baseDelayMs, maxDelayMs, random));
      continue;
    }

    // Other 4xx (400/404/409/422 …): malformed/not-permitted — un-recoverable.
    void lastErr;
    throw new TelephonyConfigError(`${label}: request rejected (${res.status})`, res.status);
  }
}

/** Exponential backoff (2^n · base) capped at maxDelayMs, plus up to 50% jitter. */
export function backoff(attempt: number, baseDelayMs: number, maxDelayMs: number, random: () => number): number {
  const exp = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
  return Math.round(exp * (0.5 + random() * 0.5));
}
