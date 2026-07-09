'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import type { AttributionModel, OrderCoverageResponse, ReconciliationResponse, SourceRoiResponse } from '@crm/types';
import { getOrderCoverage, getReconciliation, getSourceRoi } from '@/lib/api';
import { Card, PageHeader, Spinner, ErrorPanel, formatMoney } from '@/components/crm/ui';
import { InfoTooltip } from '@/components/crm/InfoTooltip';

const MODELS: Array<{ value: AttributionModel; label: string }> = [
  { value: 'first_touch', label: 'First-touch' },
  { value: 'last_touch', label: 'Last-touch' },
  { value: 'linear', label: 'Linear' },
  { value: 'time_decay', label: 'Time-decay' },
];

export default function AttributionPage() {
  const { getToken } = useAuth();
  const [coverage, setCoverage] = useState<OrderCoverageResponse | null>(null);
  const [model, setModel] = useState<AttributionModel>('first_touch');
  const [roi, setRoi] = useState<SourceRoiResponse | null>(null);
  const [recon, setRecon] = useState<ReconciliationResponse | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRoi = useCallback((m: AttributionModel) => {
    getSourceRoi(getToken, m).then(setRoi).catch(() => setRoi(null));
  }, [getToken]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const cov = await getOrderCoverage(getToken);
      setCoverage(cov);
      setReady(true);
      loadRoi(model);
      getReconciliation(getToken).then(setRecon).catch(() => setRecon(null));
    } catch (err) {
      setError((err as Error).message);
      setReady(true);
    }
  }, [getToken, loadRoi, model]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready) return <Spinner label="Measuring attribution coverage…" />;

  const known = coverage?.ordersWithKnownSource ?? 0;
  const total = coverage?.totalOrders ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Attribution"
        subtitle="Where customers first came from. We capture first-touch via Shopify cart attributes and store every touchpoint — bucketing on first-touch by default (the model is always labelled)."
      />

      {error && <ErrorPanel message={error} onRetry={load} />}

      {/* Coverage — orders with a known source ÷ all. "unknown" is honest. */}
      <Card title="Attribution coverage" action={<InfoTooltip metricKey="attribution_coverage" />}>
        <div className="flex flex-wrap items-baseline gap-4">
          <div>
            <span className="text-3xl font-bold">{coverage?.coveragePct ?? 0}%</span>
            <span className="ml-2 text-sm text-slate-500">
              {known.toLocaleString()} of {total.toLocaleString()} orders carry a known first-touch source
            </span>
          </div>
        </div>
        {coverage && coverage.bySource.length > 0 && (
          <div className="mt-4 space-y-1">
            {coverage.bySource.map((s) => {
              const pct = total > 0 ? (s.orders / total) * 100 : 0;
              const isUnknown = s.source === 'unknown';
              return (
                <div key={s.source} className="flex items-center gap-3 text-sm">
                  <span className={`w-24 shrink-0 capitalize ${isUnknown ? 'text-slate-400 italic' : 'font-medium'}`}>{s.source}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                    <div className={`h-full ${isUnknown ? 'bg-slate-300 dark:bg-slate-600' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-16 shrink-0 text-right text-slate-500">{s.orders.toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-3 text-xs text-slate-400">Missing UTMs (Shopify’s default) land in &quot;unknown&quot; — we never fabricate a source. Add the cart-attributes snippet to raise coverage.</p>
      </Card>

      {/* LTV-by-source under the selected (labelled) model. */}
      <Card
        title="LTV by first-touch source"
        action={
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Model:</span>
            <select
              value={model}
              onChange={(e) => { const m = e.target.value as AttributionModel; setModel(m); loadRoi(m); }}
              className="rounded-lg border border-slate-300 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
            >
              {MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
        }
      >
        <p className="mb-2 text-xs text-slate-500">
          Bucketed on <span className="font-medium">{MODELS.find((m) => m.value === roi?.model)?.label ?? '—'}</span>. Revenue is store-actual.
        </p>
        {!roi || roi.data.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">Not enough attributed data yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2">Source</th><th>Customers</th><th>Net revenue</th><th>Avg LTV</th>
                </tr>
              </thead>
              <tbody>
                {roi.data.map((r) => (
                  <tr key={r.source} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-2 font-medium capitalize">{r.source}</td>
                    <td>{r.customersAcquired}</td>
                    <td>{formatMoney(r.ltvTotalMinor, roi.currency ?? 'INR')}</td>
                    <td>{formatMoney(r.avgLtvMinor, roi.currency ?? 'INR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Reconciliation vs store-actual. */}
      {recon && (
        <Card title="Reconcile vs store-actual" action={<InfoTooltip metricKey="conversions" />}>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div><p className="text-2xl font-bold">{recon.metaReportedConversions}</p><p className="text-xs text-slate-500">Meta-reported</p></div>
            <div><p className="text-2xl font-bold">{recon.storeActualOrders}</p><p className="text-xs text-slate-500">Store-actual orders</p></div>
            <div><p className="text-2xl font-bold">{formatMoney(recon.storeActualRevenueMinor, recon.currency ?? 'INR')}</p><p className="text-xs text-slate-500">Store-actual revenue</p></div>
          </div>
          <p className="mt-3 text-xs text-slate-400">{recon.note}</p>
        </Card>
      )}
    </div>
  );
}
