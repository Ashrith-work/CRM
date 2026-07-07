import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-expo';
import type { TokenGetter } from './api';

export type LoadState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T };

/**
 * The house async-screen pattern (loading | error | ready). The loader receives
 * Clerk's `getToken` (not a pre-fetched string) and hands it to the api client,
 * which fetches a fresh token per request and refreshes+retries once on a 401.
 * Returns the state plus a `reload` for Retry / after-mutation refresh.
 */
export function useAuthedLoad<T>(
  fn: (getToken: TokenGetter) => Promise<T>,
  deps: unknown[],
): { state: LoadState<T>; reload: () => Promise<void> } {
  const { getToken } = useAuth();
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      setState({ status: 'ready', data: await fn(getToken) });
    } catch (err) {
      setState({ status: 'error', message: (err as Error).message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getToken, ...deps]);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, reload: load };
}
