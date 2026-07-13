'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PERIOD_PRESETS, type KpiMetric, type KpiResponse, type PeriodPreset } from '@crm/types';
import type { TokenGetter } from '@/lib/api';
import { getKpis } from '@/lib/api';
import { Card, Spinner, ErrorPanel, formatMoney, formatDate } from './ui';
import { MetricGrid, MetricTile, type MetricDelta } from './MetricTile';
import { InfoTooltip } from './InfoTooltip';
import { EmptyState } from './EmptyState';

const PRESET_LABELS: Record<PeriodPreset, string> = {
  today: 'Today',
  week: 'This week',
  month: 'This month',
  quarter: 'This quarter',
  custom: 'Custom range',
};

/** Format a metric value by its unit (money/count/rate/ratio). */
function formatValue(m: KpiMetric, currency: string): string {
  if (m.value === null) return '—';
  switch (m.unit) {
    case 'money':
      return formatMoney(m.value, currency);
    case 'rate':
      return `${(m.value * 100).toFixed(1)}%`;
    case 'ratio':
      return m.value.toFixed(2);
    default:
      return Math.round(m.value).toLocaleString();
  }
}

/** Previous-period delta for the tile chip — direction + semantic color. */
function toDelta(m: KpiMetric): MetricDelta | null {
  if (m.value === null || m.previous === null || m.previous === 0) return null;
  const pct = (m.value - m.previous) / Math.abs(m.previous);
  const improved = m.betterWhenLower ? m.value < m.previous : m.value > m.previous;
  return { pct, good: improved };
}

export function CommerceKpis({ getToken }: { getToken: TokenGetter }) {
  const [preset, setPreset] = useState<PeriodPreset>('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<KpiResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const params = preset === 'custom' ? { period: preset, from, to } : { period: preset };
      setData(await getKpis(getToken, params));
      setStatus('ready');
    } catch (err) {
      setMessage((err as Error).message);
      setStatus('error');
    }
  }, [getToken, preset, from, to]);

  useEffect(() => {
    // For custom, wait until both dates are set.
    if (preset === 'custom' && (!from || !to)) return;
    void load();
  }, [load, preset, from, to]);

  const currency = data?.currency ?? 'INR';
  const hasData = data && data.metrics.some((m) => (m.value ?? 0) !== 0);

  return (
    <Card
      title="Store KPIs"
      action={
        <PeriodSelector
          preset={preset}
          from={from}
          to={to}
          onPreset={setPreset}
          onFrom={setFrom}
          onTo={setTo}
        />
      }
    >
      {status === 'loading' ? (
        <Spinner />
      ) : status === 'error' ? (
        <ErrorPanel message={message} onRetry={load} />
      ) : !data ? null : !hasData ? (
        <EmptyState icon="🧾" title="No orders in this period" description="Pick a wider range — KPIs are computed from paid/fulfilled Shopify orders in the selected window." />
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-slate-400">
            {formatDate(data.period.start)} – {formatDate(data.period.end)} · {data.period.timezone}
            {data.lastSyncedAt && <> · data synced {formatDate(data.lastSyncedAt)}</>}
            <> · Δ vs previous period</>
          </p>

          <MetricGrid>
            {data.metrics.map((m) => (
              <MetricTile
                key={m.key}
                label={m.label}
                metricKey={m.key}
                value={formatValue(m, currency)}
                delta={toDelta(m)}
              />
            ))}
          </MetricGrid>

          <KpiTrendChart trend={data.trend} currency={currency} />

          <div className="grid gap-4 md:grid-cols-2">
            <RankedBars
              title="Top products by revenue"
              metricKey="top_products"
              rows={data.topProducts.map((p) => ({ label: p.title, revenueMinor: p.revenueMinor, units: p.units }))}
              currency={currency}
            />
            <RankedBars
              title="Top categories by revenue"
              metricKey="top_categories"
              rows={data.topCategories.map((c) => ({ label: c.category, revenueMinor: c.revenueMinor, units: c.units }))}
              currency={currency}
            />
          </div>
        </div>
      )}
    </Card>
  );
}

function PeriodSelector({
  preset,
  from,
  to,
  onPreset,
  onFrom,
  onTo,
}: {
  preset: PeriodPreset;
  from: string;
  to: string;
  onPreset: (p: PeriodPreset) => void;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
}) {
  const selectCls =
    'rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200';
  return (
    <span className="flex flex-wrap items-center gap-2">
      <select className={selectCls} value={preset} onChange={(e) => onPreset(e.target.value as PeriodPreset)} aria-label="KPI period">
        {PERIOD_PRESETS.map((p) => (
          <option key={p} value={p}>{PRESET_LABELS[p]}</option>
        ))}
      </select>
      {preset === 'custom' && (
        <>
          <input type="date" className={selectCls} value={from} onChange={(e) => onFrom(e.target.value)} aria-label="From date" />
          <span className="text-xs text-slate-400">→</span>
          <input type="date" className={selectCls} value={to} onChange={(e) => onTo(e.target.value)} aria-label="To date" />
        </>
      )}
    </span>
  );
}

/** A ranked horizontal-bar list (top products / top categories). */
function RankedBars({
  title,
  metricKey,
  rows,
  currency,
}: {
  title: string;
  metricKey: string;
  rows: { label: string; revenueMinor: number; units: number }[];
  currency: string;
}) {
  const max = rows[0]?.revenueMinor || 1;
  return (
    <div>
      <p className="mb-2 flex items-center text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
        <InfoTooltip metricKey={metricKey} />
      </p>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-400">No data in this period.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.slice(0, 6).map((r, i) => (
            <div key={`${r.label}-${i}`} className="flex items-center gap-3 text-sm">
              <span className="w-40 shrink-0 truncate font-medium text-slate-700 dark:text-slate-300" title={r.label}>{r.label}</span>
              <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                <div className="h-full rounded bg-brand-500" style={{ width: `${(r.revenueMinor / max) * 100}%` }} />
              </div>
              <span className="w-24 shrink-0 text-right tabular-nums text-slate-500">{formatMoney(r.revenueMinor, currency)}</span>
              <span className="w-12 shrink-0 text-right tabular-nums text-slate-400">{r.units.toLocaleString()}u</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function KpiTrendChart({ trend, currency }: { trend: KpiResponse['trend']; currency: string }) {
  const chartData = useMemo(
    () => trend.map((t) => ({ label: t.start, revenue: t.netRevenueMinor / 100, orders: t.orderCount })),
    [trend],
  );
  if (chartData.length === 0) {
    return <EmptyState icon="📈" title="No revenue in this period" description="Revenue over time appears once there are paid/fulfilled orders." />;
  }
  return (
    <div>
      <p className="mb-1 flex items-center text-xs font-semibold uppercase tracking-wide text-slate-500">Revenue over time</p>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
          <defs>
            <linearGradient id="kpiRev" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#274fd6" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#274fd6" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} minTickGap={28} tickFormatter={(v: string) => v.slice(5)} />
          <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} width={54} tickFormatter={(v: number) => formatCompact(v, currency)} />
          <RTooltip
            formatter={(v: number) => formatMoney(Math.round(v * 100), currency)}
            labelFormatter={(l: string) => l}
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
          />
          <Area type="monotone" dataKey="revenue" stroke="#274fd6" strokeWidth={2} fill="url(#kpiRev)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Compact axis money label (₹1.2L / ₹3.4Cr) without over-widening the axis. */
function formatCompact(major: number, currency: string): string {
  const sym = currency === 'INR' ? '₹' : '';
  if (major >= 1e7) return `${sym}${(major / 1e7).toFixed(1)}Cr`;
  if (major >= 1e5) return `${sym}${(major / 1e5).toFixed(1)}L`;
  if (major >= 1e3) return `${sym}${(major / 1e3).toFixed(0)}k`;
  return `${sym}${major}`;
}
