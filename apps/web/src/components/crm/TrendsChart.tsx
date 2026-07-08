'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TrendMetric, TrendInterval, TrendsResponse } from '@crm/types';

const BRAND = '#274fd6';

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Sum minor units across currencies → major units (trend shape only; tiles
 * keep currencies separate). */
function revenueMajor(value: { amountMinor: number }[]): number {
  return value.reduce((acc, m) => acc + m.amountMinor, 0) / 100;
}

/**
 * Recharts bar chart of a trend series. Controlled: the page owns metric +
 * interval. Y is a deal count for won/created, or summed revenue (major units)
 * for the revenue metric.
 */
export function TrendsChart({
  trends,
  onMetricChange,
  onIntervalChange,
}: {
  trends: TrendsResponse;
  onMetricChange: (m: TrendMetric) => void;
  onIntervalChange: (i: TrendInterval) => void;
}) {
  const isRevenue = trends.metric === 'revenue';
  const data = trends.points.map((p) => ({
    label: shortDate(p.start),
    value: isRevenue ? revenueMajor(p.valueByCurrency) : p.count,
  }));
  const hasData = data.some((d) => d.value > 0);

  const selectClass =
    'rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-brand-500';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={trends.metric}
          onChange={(e) => onMetricChange(e.target.value as TrendMetric)}
          className={selectClass}
        >
          <option value="won">Deals won</option>
          <option value="created">Deals created</option>
          <option value="revenue">Revenue won</option>
        </select>
        <select
          value={trends.interval}
          onChange={(e) => onIntervalChange(e.target.value as TrendInterval)}
          className={selectClass}
        >
          <option value="week">By week</option>
          <option value="month">By month</option>
        </select>
      </div>

      {hasData ? (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
              <YAxis tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip
                cursor={{ fill: '#f1f5f9' }}
                contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
                formatter={(v: number) => [isRevenue ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v, isRevenue ? 'Revenue' : 'Count']}
              />
              <Bar dataKey="value" fill={BRAND} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="py-12 text-center text-sm text-slate-400">No data for this period yet.</p>
      )}
    </div>
  );
}
