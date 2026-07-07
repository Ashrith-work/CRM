'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import type { Integration } from '@crm/types';
import {
  connectIntegration,
  disconnectIntegration,
  listIntegrations,
} from '@/lib/api';
import { Button, Card, ErrorPanel, PageHeader, Spinner } from '@/components/crm/ui';
import { EmptyState } from '@/components/crm/EmptyState';

const STATUS_BADGE: Record<Integration['status'], string> = {
  CONNECTED: 'bg-green-50 text-green-700 dark:bg-green-950/50 dark:text-green-400',
  DISCONNECTED: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  ERROR: 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-400',
};

export default function IntegrationsPage() {
  const { getToken } = useAuth();
  const [state, setState] = useState<{ status: 'loading' | 'error' | 'ready'; data?: Integration[]; message?: string }>({
    status: 'loading',
  });
  const [provider, setProvider] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const res = await listIntegrations(getToken);
      setState({ status: 'ready', data: res.data });
    } catch (err) {
      setState({ status: 'error', message: (err as Error).message });
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setActionError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      const msg = (err as Error).message;
      // The API returns { code: 'FORBIDDEN' } for a rep without integration:manage.
      setActionError(
        /permission|forbidden/i.test(msg)
          ? 'You need admin access (integration:manage) to change integrations.'
          : msg,
      );
    } finally {
      setBusy(null);
    }
  };

  if (state.status === 'loading') return <Spinner />;
  if (state.status === 'error') return <ErrorPanel message={state.message ?? ''} onRetry={() => void load()} />;
  const integrations = state.data ?? [];

  return (
    <div className="space-y-4">
      <PageHeader title="Integrations" subtitle="Connect the third-party services this workspace uses." />

      {actionError && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          {actionError}
        </p>
      )}

      {integrations.length === 0 ? (
        <EmptyState
          icon="🔌"
          title="No integrations yet"
          description="Connect a provider (e.g. MYOPERATOR, CLOUDINARY) to power calls and recordings."
        />
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {integrations.map((it) => (
              <li key={it.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium text-slate-800 dark:text-slate-100">{it.provider}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    {it.externalAccountId ? `${it.externalAccountId} · ` : ''}
                    {it.connectedAt ? `connected ${new Date(it.connectedAt).toLocaleDateString()}` : 'not connected'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[it.status]}`}>
                    {it.status}
                  </span>
                  {it.status === 'CONNECTED' ? (
                    <Button
                      variant="secondary"
                      disabled={busy === it.id}
                      onClick={() => void run(it.id, () => disconnectIntegration(getToken, it.id))}
                    >
                      Disconnect
                    </Button>
                  ) : (
                    <Button
                      disabled={busy === it.id}
                      onClick={() => void run(it.id, () => connectIntegration(getToken, { provider: it.provider }))}
                    >
                      Connect
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Add a provider">
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700 dark:text-slate-300">Provider</span>
            <input
              value={provider}
              onChange={(e) => setProvider(e.target.value.toUpperCase())}
              placeholder="e.g. SHOPIFY"
              className="w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
          <Button
            disabled={!provider.trim() || busy === 'new'}
            onClick={() =>
              void run('new', async () => {
                await connectIntegration(getToken, { provider: provider.trim() });
                setProvider('');
              })
            }
          >
            Connect
          </Button>
        </div>
      </Card>
    </div>
  );
}
