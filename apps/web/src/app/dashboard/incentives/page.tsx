'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import type { Incentive, IncentiveConfigResponse } from '@crm/types';
import { getIncentiveConfig, listIncentives } from '@/lib/api';
import { Card, PageHeader, Spinner, ErrorPanel, formatMoney, formatDate } from '@/components/crm/ui';

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  REDEEMED: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  EXPIRED: 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300',
};

export default function IncentivesPage() {
  const { getToken } = useAuth();
  const [config, setConfig] = useState<IncentiveConfigResponse | null>(null);
  const [rows, setRows] = useState<Incentive[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [cfg, list] = await Promise.all([getIncentiveConfig(getToken), listIncentives(getToken)]);
      setConfig(cfg);
      setRows(list.data);
      setReady(true);
    } catch (err) {
      setError((err as Error).message);
      setReady(true);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ready) return <Spinner label="Loading incentives…" />;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Incentives"
        subtitle="Threshold rewards issued as capped, SKU-excluded, minimum-order Shopify discount codes. Redeem once; a refund of the qualifying order reverses it."
      />

      {error && <ErrorPanel message={error} onRetry={load} />}

      {/* Engine config — states the numbers, honest about margin safety. */}
      {config && (
        <Card title="Engine settings">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <Field label="Trigger">
              Buy <b>{config.trigger.threshold}</b> {config.trigger.metric.replace('_', ' ')}
            </Field>
            <Field label="Reward (value cap)">{formatMoney(config.maxValueMinor, 'INR')}</Field>
            <Field label="Min next order">{formatMoney(config.minNextOrderMinor, 'INR')}</Field>
            <Field label="Margin guard">
              {config.marginGuard ? (
                <span className="text-emerald-600">On · excludes SKUs below {config.marginFloorPct}% margin</span>
              ) : (
                <span className="text-amber-600">Off · low-margin SKUs are NOT excluded (exposed)</span>
              )}
            </Field>
          </div>
        </Card>
      )}

      <Card title={`Issued incentives (${rows.length})`}>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            No incentives issued yet. They fire automatically when a customer crosses the threshold on a paid order.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2">Code</th>
                  <th>Customer</th>
                  <th>Value cap</th>
                  <th>Min order</th>
                  <th>Excl. SKUs</th>
                  <th>Guard</th>
                  <th>Valid until</th>
                  <th>Status</th>
                  <th>Redeemed by</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-2 font-mono text-xs font-medium">{r.discountCode ?? '—'}</td>
                    <td className="max-w-[8rem] truncate text-slate-500">{r.customerId}</td>
                    <td>{formatMoney(r.maxValueMinor, 'INR')}</td>
                    <td>{formatMoney(r.minNextOrderMinor, 'INR')}</td>
                    <td>{r.excludedSkuRule?.productExternalIds.length ?? 0}</td>
                    <td>{r.marginGuard ? '✓' : <span className="text-amber-600">off</span>}</td>
                    <td className="text-slate-500">{formatDate(r.validUntil)}</td>
                    <td>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[r.status]}`}>{r.status.toLowerCase()}</span>
                    </td>
                    <td className="max-w-[8rem] truncate text-slate-400">{r.redeemedOrderId ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5">{children}</p>
    </div>
  );
}
