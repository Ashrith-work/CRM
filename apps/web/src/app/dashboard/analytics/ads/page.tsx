'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import type {
  AdPerformanceResponse,
  AttributionModel,
  MetaStatus,
  ReconciliationResponse,
  RuleGroup,
  SourceRoiResponse,
} from '@crm/types';
import {
  getAdPerformance,
  getMetaStatus,
  getReconciliation,
  getSourceRoi,
  syncMetaNow,
} from '@/lib/api';
import { Card, PageHeader, Button, Spinner, ErrorPanel, formatMoney } from '@/components/crm/ui';
import { InfoTooltip } from '@/components/crm/InfoTooltip';

const MODELS: Array<{ value: AttributionModel; label: string }> = [
  { value: 'first_touch', label: 'First-touch' },
  { value: 'last_touch', label: 'Last-touch' },
  { value: 'linear', label: 'Linear' },
  { value: 'time_decay', label: 'Time-decay' },
];

// Lookalike-seed hand-off: High-CLV customers (source is not a segment field —
// filter to your Meta-acquired cohort in the segment builder).
const LOOKALIKE_SEED: RuleGroup = { op: 'AND', rules: [{ field: 'clvBand', op: 'eq', value: 'High' }] };
function buildSegmentHref(rule: RuleGroup): string {
  return `/dashboard/segments/new?preset=${encodeURIComponent(JSON.stringify(rule))}`;
}

function money(minor: number | null, currency: string | null): string {
  if (minor == null) return '—';
  return formatMoney(minor, currency ?? 'INR');
}

export default function AdsPage() {
  const { getToken } = useAuth();
  const [status, setStatus] = useState<MetaStatus | null>(null);
  const [model, setModel] = useState<AttributionModel>('first_touch');
  const [roi, setRoi] = useState<SourceRoiResponse | null>(null);
  const [recon, setRecon] = useState<ReconciliationResponse | null>(null);
  const [perf, setPerf] = useState<AdPerformanceResponse | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const loadRoi = useCallback(
    async (m: AttributionModel) => {
      getSourceRoi(getToken, m).then(setRoi).catch(() => setRoi(null));
    },
    [getToken],
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const s = await getMetaStatus(getToken);
      setStatus(s);
      setReady(true);
      void loadRoi(model);
      getReconciliation(getToken).then(setRecon).catch(() => setRecon(null));
      getAdPerformance(getToken).then(setPerf).catch(() => setPerf(null));
    } catch (err) {
      setError((err as Error).message);
      setReady(true);
    }
  }, [getToken, loadRoi, model]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onModelChange(m: AttributionModel) {
    setModel(m);
    await loadRoi(m);
  }

  async function onSync() {
    setSyncing(true);
    try {
      await syncMetaNow(getToken);
    } finally {
      setSyncing(false);
    }
  }

  if (!ready) return <Spinner label="Loading ad performance…" />;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Source ROI"
        subtitle="What each acquisition source returns. Attribution buckets on first-touch by default — the model is labelled, and revenue is store-actual."
        action={
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status?.status === 'CONNECTED' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>
              Meta: {status?.status.toLowerCase() ?? 'unknown'}
            </span>
            <Button variant="secondary" onClick={onSync} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync now'}
            </Button>
          </div>
        }
      />

      {error && <ErrorPanel message={error} onRetry={load} />}

      {status?.status !== 'CONNECTED' && (
        <Card>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Meta isn&apos;t connected yet{status?.reason ? ` — ${status.reason}` : ''}. Set <code>META_ACCESS_TOKEN</code> and{' '}
            <code>META_AD_ACCOUNT_ID</code>, then connect from Settings → Integrations. Attribution still works from your store data below.
          </p>
        </Card>
      )}

      {/* Model selector + coverage. */}
      <Card
        title="LTV : CAC by source"
        action={
          <div className="flex items-center gap-2">
            <InfoTooltip metricKey="ltv_cac" />
            <select
              value={model}
              onChange={(e) => void onModelChange(e.target.value as AttributionModel)}
              className="rounded-lg border border-slate-300 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
            >
              {MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        }
      >
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
          Model: <span className="font-medium">{MODELS.find((m) => m.value === roi?.model)?.label ?? '—'}</span> · Attribution coverage:{' '}
          <span className="font-medium">{roi?.coveragePct ?? 0}%</span> <InfoTooltip metricKey="attribution_coverage" /> · Revenue is store-actual.
        </p>
        {!roi || roi.data.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">Not enough data yet. Once orders carry a first-touch source, LTV:CAC renders here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2">Source</th>
                  <th>Customers</th>
                  <th>Spend</th>
                  <th>Avg LTV</th>
                  <th>CAC <InfoTooltip metricKey="cac" /></th>
                  <th>LTV:CAC</th>
                  <th>ROAS <InfoTooltip metricKey="roas" /></th>
                  <th>Payback <InfoTooltip metricKey="payback" /></th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {roi.data.map((r) => (
                  <tr key={r.source} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-2 font-medium capitalize">{r.source}</td>
                    <td>{r.customersAcquired}</td>
                    <td>{money(r.spendMinor, roi.currency)}</td>
                    <td>{money(r.avgLtvMinor, roi.currency)}</td>
                    <td>{money(r.cacMinor, roi.currency)}</td>
                    <td className={r.ltvCacRatio != null && r.ltvCacRatio < 1 ? 'text-red-600' : ''}>{r.ltvCacRatio?.toFixed(2) ?? '—'}</td>
                    <td>{r.roas?.toFixed(2) ?? '—'}</td>
                    <td>{r.paybackMonths != null ? `${r.paybackMonths} mo` : '—'}</td>
                    <td className="text-right">
                      <Link href={buildSegmentHref(LOOKALIKE_SEED)} className="text-xs text-brand-600 hover:underline">
                        Lookalike seed →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Meta-vs-store reconciliation. */}
      {recon && (
        <Card title="Meta-reported vs store-actual" action={<InfoTooltip metricKey="conversions" />}>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold">{recon.metaReportedConversions}</p>
              <p className="text-xs text-slate-500">Meta-reported conversions</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{recon.storeActualOrders}</p>
              <p className="text-xs text-slate-500">Store-actual orders</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{money(recon.storeActualRevenueMinor, recon.currency)}</p>
              <p className="text-xs text-slate-500">Store-actual revenue</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-400">{recon.note}</p>
        </Card>
      )}

      {/* Ad performance rollups. */}
      {perf && perf.data.length > 0 && (
        <Card title="Campaign / adset / ad performance">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2">Level</th>
                  <th>Name</th>
                  <th>Spend</th>
                  <th>Impr.</th>
                  <th>Clicks</th>
                  <th>CTR</th>
                  <th>Conv.</th>
                </tr>
              </thead>
              <tbody>
                {perf.data.slice(0, 25).map((r) => (
                  <tr key={`${r.entityType}:${r.entityId}`} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-2 capitalize text-slate-500">{r.entityType}</td>
                    <td className="font-medium">{r.name}</td>
                    <td>{money(r.spendMinor, perf.currency)}</td>
                    <td>{r.impressions.toLocaleString()}</td>
                    <td>{r.clicks.toLocaleString()}</td>
                    <td>{(r.ctr * 100).toFixed(2)}%</td>
                    <td>{r.conversions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
