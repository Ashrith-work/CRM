import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-expo';

export type LoadState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T };

/**
 * The house async-screen pattern (loading | error | ready) wired to Clerk's
 * getToken. Returns the state plus a `reload` for Retry / after-mutation refresh.
 */
export function useAuthedLoad<T>(
  fn: (token: string) => Promise<T>,
  deps: unknown[],
): { state: LoadState<T>; reload: () => Promise<void> } {
  const { getToken } = useAuth();
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const token = await getToken();
      if (!token) throw new Error('No session token');
      setState({ status: 'ready', data: await fn(token) });
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
