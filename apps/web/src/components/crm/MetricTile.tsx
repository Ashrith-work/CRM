'use client';

import type { ReactNode } from 'react';
import type { MoneyByCurrency } from '@crm/types';
import { formatMoney } from './ui';

/** A single headline metric in a bordered card. */
export function MetricTile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export function MetricGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-3">{children}</div>;
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
