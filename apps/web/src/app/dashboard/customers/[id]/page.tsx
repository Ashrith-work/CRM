'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import type { Customer360, RecentOrder, TimelineItem as TimelineItemType } from '@crm/types';
import {
  exportCustomer,
  getCustomer360,
  getCustomerTimeline,
  getRecentOrders,
  type RecentOrdersParams,
} from '@/lib/api';
import { Button, Card, ErrorPanel, PageHeader, Row, Spinner, dateOnly, formatMoney } from '@/components/crm/ui';
import { MetricGrid } from '@/components/crm/MetricTile';
import { EmptyState } from '@/components/crm/EmptyState';
import { InfoTooltip } from '@/components/crm/InfoTooltip';
import { TimelineItem } from '@/components/crm/TimelineItem';

const CONSENT_BADGE: Record<string, string> = {
  GRANTED: 'bg-green-50 text-green-700 dark:bg-green-950/50 dark:text-green-400',
  WITHDRAWN: 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-400',
  NOT_CAPTURED: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
};
const TIMELINE_TYPES = ['order', 'event', 'message', 'call', 'ticket', 'note', 'return', 'lead'];

export default function Customer360Page() {
  const { getToken } = useAuth();
  const id = String(useParams().id);
  const [state, setState] = useState<{ status: 'loading' | 'error' | 'ready'; data?: Customer360; message?: string }>({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const data = await getCustomer360(getToken, id);
      setState({ status: 'ready', data });
    } catch (err) {
      setState({ status: 'error', message: (err as Error).message });
    }
  }, [getToken, id]);
  useEffect(() => void load(), [load]);

  if (state.status === 'loading') return <Spinner />;
  if (state.status === 'error') return <ErrorPanel message={state.message ?? ''} onRetry={() => void load()} />;
  const c = state.data!;
  const currency = c.features.currency ?? 'INR';
  const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || c.id;

  return (
    <div className="space-y-4">
      <PageHeader title={name} subtitle="Customer 360" action={<ExportButton id={id} />} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Identity">
          <Row label="Email" value={c.email ?? '—'} />
          <Row label="Phone" value={c.phone ?? '—'} />
          <Row label="Shopify id" value={c.externalId ?? '—'} />
          {c.masked && <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">PII masked — needs admin access to unmask.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {c.consents.map((k) => (
              <span key={k.purpose} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${CONSENT_BADGE[k.status]}`}>
                {k.purpose.replace('_', ' ')}: {k.status.toLowerCase().replace('_', ' ')}
              </span>
            ))}
          </div>
        </Card>

        <div className="lg:col-span-2">
          <Card title="Metrics">
            <MetricGrid>
              <MetricBadge label="Net revenue" metricKey="net_revenue" value={formatMoney(c.features.netRevenueMinor, currency)} />
              <MetricBadge label="Orders" metricKey="order_count" value={c.features.orderCount} />
              <MetricBadge label="Avg order" metricKey="avg_order_value" value={formatMoney(c.features.avgOrderValueMinor, currency)} />
              <MetricBadge label="VIP tier" metricKey="vip_tier" value={c.features.badges.vipTier ?? 'Standard'} />
              <MetricBadge label="RFM" metricKey="rfm" value={c.features.badges.rfm ?? '—'} />
              <MetricBadge label="CLV" metricKey="clv" value={c.features.badges.clv != null ? formatMoney(c.features.badges.clv, currency) : '—'} />
              <MetricBadge label="Churn risk" metricKey="churn_risk" value={c.features.badges.churnRisk != null ? `${Math.round(c.features.badges.churnRisk * 100)}%` : '—'} />
              <MetricBadge label="Size" metricKey="apparel_size" value={c.features.badges.apparelSize ?? '—'} />
              <MetricBadge label="Fit" metricKey="fit" value={c.features.badges.fit ?? '—'} />
              <MetricBadge label="Style" metricKey="style_affinity" value={c.features.badges.styleAffinity ?? '—'} />
            </MetricGrid>
            <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">RFM / CLV / Churn / Size / Fit / Style are placeholders until analytics (M3).</p>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RecentOrdersPanel id={id} defaultCurrency={currency} />
        <TimelinePanel id={id} />
      </div>
    </div>
  );
}

function MetricBadge({ label, metricKey, value }: { label: string; metricKey: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <p className="flex items-center text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
        <InfoTooltip metricKey={metricKey} />
      </p>
      <p className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-100">{value}</p>
    </div>
  );
}

// --- Timeline panel ---------------------------------------------------------
function TimelinePanel({ id }: { id: string }) {
  const { getToken } = useAuth();
  const [type, setType] = useState('');
  const [items, setItems] = useState<TimelineItemType[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(
    async (append: boolean) => {
      try {
        const res = await getCustomerTimeline(getToken, id, { type: type || undefined, cursor: append && cursor ? cursor : undefined });
        setItems((prev) => (append ? [...prev, ...res.data] : res.data));
        setCursor(res.nextCursor);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [getToken, id, type, cursor],
  );
  // Reload on type change.
  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  return (
    <Card
      title="Timeline"
      action={
        <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800">
          <option value="">All types</option>
          {TIMELINE_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      }
    >
      {error && <p className="text-sm text-red-600">{error}</p>}
      {items.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">No activity yet.</p>
      ) : (
        <ol className="space-y-3">
          {items.map((it) => (
            <TimelineItem key={it.id} item={it} />
          ))}
        </ol>
      )}
      {cursor && (
        <div className="mt-3">
          <Button variant="secondary" onClick={() => void load(true)}>Load more</Button>
        </div>
      )}
    </Card>
  );
}

// --- Recent orders panel + range control ------------------------------------
const PRESETS = [
  { label: 'Last 3', params: { limit: 3 } },
  { label: 'Last 6', params: { limit: 6 } },
  { label: 'Last 12', params: { limit: 12 } },
  { label: 'All', params: { limit: 0 } },
];

function RecentOrdersPanel({ id, defaultCurrency }: { id: string; defaultCurrency: string }) {
  const { getToken } = useAuth();
  const [params, setParams] = useState<RecentOrdersParams>({ limit: 3 });
  const [orders, setOrders] = useState<RecentOrder[]>([]);
  const [error, setError] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const activeLimit = params.from || params.to || params.year ? null : params.limit;

  const load = useCallback(async () => {
    try {
      const res = await getRecentOrders(getToken, id, params);
      setOrders(res.data);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [getToken, id, params]);
  useEffect(() => void load(), [load]);

  return (
    <Card title="Recent orders">
      <div className="mb-3 space-y-2">
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => setParams(p.params)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${activeLimit === p.params.limit ? 'bg-brand-600 text-white' : 'border border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-800" />
          <span className="text-slate-400">–</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-800" />
          <button onClick={() => (from || to) && setParams({ from: from ? `${from}T00:00:00Z` : undefined, to: to ? `${to}T23:59:59Z` : undefined })} className="rounded border border-slate-300 px-2 py-1 text-slate-600 dark:border-slate-600 dark:text-slate-300">
            Apply range
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input type="number" placeholder="Year" value={year} onChange={(e) => setYear(e.target.value)} className="w-20 rounded border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-800" />
          <select value={month} onChange={(e) => setMonth(e.target.value)} className="rounded border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-800">
            <option value="">Any month</option>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>{new Date(2000, i, 1).toLocaleString('en-US', { month: 'short' })}</option>
            ))}
          </select>
          <button onClick={() => year && setParams({ year: Number(year), month: month ? Number(month) : undefined })} className="rounded border border-slate-300 px-2 py-1 text-slate-600 dark:border-slate-600 dark:text-slate-300">
            Apply period
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {orders.length === 0 ? (
        <EmptyState icon="🧾" title="No orders yet" description="This customer has not ordered in the selected range." />
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {orders.map((o) => (
            <li key={o.id} className="py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-slate-800 dark:text-slate-100">
                  {o.monthLabel} · #{o.orderNumber ?? o.id.slice(-6)}
                </span>
                <span className="font-semibold text-slate-700 dark:text-slate-200">{formatMoney(o.netMinor, o.currency || defaultCurrency)}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">{o.status.toLowerCase()}</span>
                {o.itemsSummary && <span className="truncate">{o.itemsSummary}</span>}
                {o.discountCode && (
                  <span className="text-green-600 dark:text-green-400">
                    {o.discountCode} −{formatMoney(o.discountMinor, o.currency || defaultCurrency)}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{dateOnly(o.placedAt)}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// --- Export button ----------------------------------------------------------
function ExportButton({ id }: { id: string }) {
  const { getToken } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const linkRef = useRef<HTMLAnchorElement>(null);

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      const blob = await exportCustomer(getToken, id);
      const url = URL.createObjectURL(blob);
      const a = linkRef.current!;
      a.href = url;
      a.download = `customer-experience-${id}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end">
      <Button onClick={() => void run()} disabled={busy}>
        {busy ? 'Preparing…' : 'ⓘ Export experience'}
      </Button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      <a ref={linkRef} className="hidden" />
    </div>
  );
}
