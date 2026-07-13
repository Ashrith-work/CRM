'use client';

import type { ReactNode } from 'react';
import type { MoneyByCurrency } from '@crm/types';
import { formatMoney } from './ui';
import { InfoTooltip } from './InfoTooltip';

/** A previous-period comparison for a tile. `good` decides the semantic color. */
export interface MetricDelta {
  /** Signed fractional change vs the previous period (e.g. +0.12 = +12%). null hides it. */
  pct: number | null;
  /** True → render green (an improvement); false → red. Set by the caller so a
   *  "lower is better" metric (refund rate) colors correctly. */
  good: boolean;
}

/**
 * A single headline metric in a bordered card. Backward-compatible: `label`,
 * `value`, `sub` are the original API. Optional `metricKey` adds a glossary
 * tooltip, `delta` adds a semantic up/down change chip, and `syncedAt` shows a
 * last-synced line — everything the KPI tile row needs.
 */
export function MetricTile({
  label,
  value,
  sub,
  metricKey,
  delta,
  syncedAt,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  metricKey?: string;
  delta?: MetricDelta | null;
  syncedAt?: string | null;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p className="flex items-center text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
        {metricKey && <InfoTooltip metricKey={metricKey} />}
      </p>
      <div className="mt-1 flex items-baseline gap-2">
        <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{value}</p>
        {delta && <DeltaChip delta={delta} />}
      </div>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
      {syncedAt && <p className="mt-1 text-[10px] text-slate-400">synced {syncedAt}</p>}
    </div>
  );
}

function DeltaChip({ delta }: { delta: MetricDelta }) {
  if (delta.pct === null || !Number.isFinite(delta.pct)) return null;
  const up = delta.pct >= 0;
  const color = delta.good
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-red-600 dark:text-red-400';
  return (
    <span className={`text-xs font-semibold tabular-nums ${color}`} title="vs previous period">
      {up ? '▲' : '▼'} {Math.abs(delta.pct * 100).toFixed(0)}%
    </span>
  );
}

export function MetricGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{children}</div>;
}

/** Render a per-currency money value (never summed across currencies). */
export function Money({ value }: { value: MoneyByCurrency }) {
  if (!value.length) return <span className="text-slate-400">—</span>;
  return (
    <span className="flex flex-col">
      {value.map((m) => (
        <span key={m.currency}>{formatMoney(m.amountMinor, m.currency)}</span>
      ))}
    </span>
  );
}

/** Format a rate in [0,1] as a whole-percent, or "—" when null. */
export function percent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}
