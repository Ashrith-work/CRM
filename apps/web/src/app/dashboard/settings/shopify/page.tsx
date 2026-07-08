'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import type { ShopifyStatus } from '@crm/types';
import { connectShopify, getShopifyStatus, shopifySyncNow } from '@/lib/api';
import { Button, Card, ErrorPanel, PageHeader, Row, Spinner, dateOnly } from '@/components/crm/ui';
import { EmptyState } from '@/components/crm/EmptyState';
import { JobStatus } from '@/components/crm/JobStatus';

const STATUS_BADGE: Record<ShopifyStatus['status'], string> = {
  CONNECTED: 'bg-green-50 text-green-700 dark:bg-green-950/50 dark:text-green-400',
  DISCONNECTED: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  ERROR: 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-400',
  PAUSED: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400',
};

const STATUS_LABEL: Record<ShopifyStatus['status'], string> = {
  CONNECTED: 'Connected',
  DISCONNECTED: 'Not connected',
  ERROR: 'Error',
  PAUSED: 'Paused',
};

export default function ShopifyPage() {
  const { getToken } = useAuth();
  const [state, setState] = useState<{ status: 'loading' | 'error' | 'ready'; data?: ShopifyStatus; message?: string }>({ status: 'loading' });
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState<'connect' | 'sync' | null>(null);
  const formRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await getShopifyStatus(getToken);
      setState({ status: 'ready', data });
      setDomain((d) => d || data.shopDomain || '');
      return data;
    } catch (err) {
      setState({ status: 'error', message: (err as Error).message });
      return null;
    }
  }, [getToken]);

  useEffect(() => {
    void load();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  // Poll while a sync is running so JobStatus stays live.
  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const data = await load();
      if (!data || data.sync?.state !== 'running') {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, 3000);
  }, [load]);

  const reconnect = async () => {
    if (!domain.trim()) return;
    setBusy('connect');
    try {
      await connectShopify(getToken, { shopDomain: domain.trim() });
      await load(); // status carries `reason` on failure — no throw, no crash
    } catch (err) {
      setState((s) => ({ ...s, message: (err as Error).message }));
    } finally {
      setBusy(null);
    }
  };

  const syncNow = async () => {
    setBusy('sync');
    try {
      await shopifySyncNow(getToken);
      await load();
      startPolling();
    } catch (err) {
      const msg = (err as Error).message;
      setState((s) => ({ ...s, message: /permission|forbidden/i.test(msg) ? 'You need admin access to sync.' : msg }));
    } finally {
      setBusy(null);
    }
  };

  if (state.status === 'loading') return <Spinner />;
  if (state.status === 'error') return <ErrorPanel message={state.message ?? ''} onRetry={() => void load()} />;

  const s = state.data!;
  const neverConnected = s.status === 'DISCONNECTED' && !s.lastSyncedAt;
  const countsDiffer = s.shopifyOrderCount != null && s.shopifyOrderCount !== s.crmOrderCount;

  const connectForm = (
    <Card title="Connection">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700 dark:text-slate-300">Shop domain</span>
          <input
            ref={formRef}
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="nerige.myshopify.com"
            className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>
        <Button disabled={busy === 'connect' || !domain.trim()} onClick={() => void reconnect()}>
          {busy === 'connect' ? 'Verifying…' : s.status === 'CONNECTED' ? 'Reconnect' : 'Connect'}
        </Button>
      </div>
      <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
        The Admin API access token comes from the server env (<code>SHOPIFY_ADMIN_ACCESS_TOKEN</code>).
      </p>
      {s.reason && s.status !== 'CONNECTED' && (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          {s.reason}
        </p>
      )}
    </Card>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Shopify"
        subtitle="Historical + live order/customer/product sync."
        action={
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_BADGE[s.status]}`}>
            {STATUS_LABEL[s.status]}
          </span>
        }
      />

      {neverConnected ? (
        <EmptyState
          icon="🛍️"
          title="Connect your Shopify store"
          description="Set SHOPIFY_ADMIN_ACCESS_TOKEN in the server env, then enter your shop domain to verify and start syncing."
          action={<Button onClick={() => formRef.current?.focus()}>Enter shop domain</Button>}
        />
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Status">
          <Row label="Shop domain" value={s.shopDomain ?? '—'} />
          <Row label="API version" value={s.apiVersion ?? '—'} />
          <Row label="Last synced" value={s.lastSyncedAt ? dateOnly(s.lastSyncedAt) : '—'} />
        </Card>

        <Card title="Order counts">
          <div className="flex items-center justify-around py-2 text-center">
            <div>
              <p className="text-2xl font-bold text-slate-800 dark:text-slate-100">{s.crmOrderCount.toLocaleString()}</p>
              <p className="text-xs uppercase tracking-wide text-slate-400">CRM</p>
            </div>
            <div className="text-slate-300 dark:text-slate-600">vs</div>
            <div>
              <p className="text-2xl font-bold text-slate-800 dark:text-slate-100">
                {s.shopifyOrderCount != null ? s.shopifyOrderCount.toLocaleString() : '—'}
              </p>
              <p className="text-xs uppercase tracking-wide text-slate-400">Shopify</p>
            </div>
          </div>
          {countsDiffer && (
            <p className="mt-1 text-center text-xs text-amber-600 dark:text-amber-400">
              Counts differ — a sync will reconcile the gap.
            </p>
          )}
        </Card>
      </div>

      {connectForm}

      <Card title="Sync" action={<Button variant="secondary" disabled={busy === 'sync'} onClick={() => void syncNow()}>{busy === 'sync' ? 'Starting…' : 'Sync now'}</Button>}>
        <JobStatus sync={s.sync} />
      </Card>
    </div>
  );
}
