'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import type { AnalyticsSummary, RecoveryStats } from '@crm/types';
import { getAnalyticsSummary, getRecoveryStats, refreshAnalytics } from '@/lib/api';
import { Card, PageHeader, Button, Spinner, ErrorPanel, formatDate, formatMoney } from '@/components/crm/ui';
import { MetricGrid } from '@/components/crm/MetricTile';
import { InfoTooltip } from '@/components/crm/InfoTooltip';
import { EmptyState } from '@/components/crm/EmptyState';

function Tile({ label, value, sub, metricKey }: { label: string; value: string; sub?: string; metricKey?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p className="flex items-center text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
        {metricKey && <InfoTooltip metricKey={metricKey} />}
      </p>
      <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export default function AnalyticsPage() {
  const { getToken } = useAuth();
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [message, setMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState('');
  const [recovery, setRecovery] = useState<RecoveryStats | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      setData(await getAnalyticsSummary(getToken));
      getRecoveryStats(getToken).then(setRecovery).catch(() => setRecovery(null));
      setStatus('ready');
    } catch (err) {
      setMessage((err as Error).message);
      setStatus('error');
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    setNote('');
    try {
      await refreshAnalytics(getToken);
      await load();
    } catch (err) {
      setNote((err as Error).message.includes('403') ? 'Only admins can trigger a refresh.' : (err as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  const currency = data?.currency ?? 'INR';
  const maxCustomers = data ? Math.max(1, ...data.distribution.map((d) => d.customers)) : 1;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Analytics"
        subtitle="RFM — recency, frequency, monetary — computed nightly from the customer_rfm view."
        action={
          <Button variant="secondary" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh now'}
          </Button>
        }
      />
      {note && <p className="text-sm text-amber-600 dark:text-amber-400">{note}</p>}

      {status === 'loading' ? (
        <Spinner />
      ) : status === 'error' ? (
        <ErrorPanel message={message} onRetry={load} />
      ) : data ? (
        <>
          <MetricGrid>
            <Tile label="Scored customers" value={`${data.scoredCustomers.toLocaleString()}`} sub={`of ${data.totalCustomers.toLocaleString()} total`} metricKey="rfm" />
            <Tile label="Net revenue" value={formatMoney(data.netRevenueMinor, currency)} metricKey="net_revenue" />
            <Tile label="Avg order value" value={formatMoney(data.aovMinor, currency)} metricKey="avg_order_value" />
            {recovery && (
              <Link href="/dashboard/campaigns" className="block">
                <Tile
                  label="Cart recovery rate"
                  value={`${(recovery.recoveryRate * 100).toFixed(1)}%`}
                  sub={`${recovery.recoveredCarts}/${recovery.abandonedCarts} carts · ${formatMoney(recovery.recoveredRevenueMinor, recovery.currency ?? currency)} recovered →`}
                  metricKey="recovery_rate"
                />
              </Link>
            )}
          </MetricGrid>

          <Card
            title="RFM segment distribution"
            action={
              <span className="flex items-center gap-2 text-xs text-slate-400">
                <InfoTooltip metricKey="rfm" />
                {data.lastRefreshedAt ? `refreshed ${formatDate(data.lastRefreshedAt)}` : 'not yet refreshed'}
              </span>
            }
          >
            {data.distribution.length === 0 ? (
              <EmptyState icon="📊" title="No RFM yet" description="Run a refresh to compute RFM segments from paid/fulfilled orders." />
            ) : (
              <div className="space-y-2">
                {data.distribution.map((d) => (
                  <div key={d.segment} className="flex items-center gap-3 text-sm">
                    <span className="w-40 shrink-0 font-medium text-slate-700 dark:text-slate-300">{d.segment}</span>
                    <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                      <div className="h-full rounded bg-brand-500" style={{ width: `${(d.customers / maxCustomers) * 100}%` }} />
                    </div>
                    <span className="w-16 shrink-0 text-right tabular-nums text-slate-600 dark:text-slate-400">{d.customers.toLocaleString()}</span>
                    <span className="w-28 shrink-0 text-right tabular-nums text-slate-500">{formatMoney(d.netRevenueMinor, currency)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
