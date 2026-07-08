'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import type {
  AnalyticsSummary,
  ChurnWatchlistResponse,
  ClvDistributionResponse,
  CohortResponse,
  MarginResponse,
  RecoveryStats,
  RevenueTrendResponse,
  RuleGroup,
} from '@crm/types';
import {
  getAnalyticsSummary,
  getChurnWatchlist,
  getClvDistribution,
  getCohorts,
  getMargin,
  getRecoveryStats,
  getRevenueTrend,
  refreshAnalytics,
} from '@/lib/api';
import { Card, PageHeader, Button, Spinner, ErrorPanel, formatDate, formatMoney } from '@/components/crm/ui';
import { MetricGrid } from '@/components/crm/MetricTile';
import { InfoTooltip } from '@/components/crm/InfoTooltip';
import { EmptyState } from '@/components/crm/EmptyState';

// ----- "Build segment from this" → M3's segment builder, pre-filled ---------
const PRESETS = {
  vip: { op: 'AND', rules: [{ field: 'clvBand', op: 'eq', value: 'High' }] },
  saveAtRisk: { op: 'AND', rules: [{ field: 'churnBand', op: 'eq', value: 'High' }, { field: 'clvBand', op: 'eq', value: 'High' }] },
  winback: { op: 'AND', rules: [{ field: 'daysSinceLast', op: 'gt', value: 60 }] },
  highValue: { op: 'AND', rules: [{ field: 'netRevenueMinor', op: 'gte', value: 200000 }] },
} satisfies Record<string, RuleGroup>;

function buildSegmentHref(rule: RuleGroup): string {
  return `/dashboard/segments/new?preset=${encodeURIComponent(JSON.stringify(rule))}`;
}

function BuildSegment({ rule, label }: { rule: RuleGroup; label: string }) {
  return (
    <Link
      href={buildSegmentHref(rule)}
      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
    >
      {label} →
    </Link>
  );
}

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

/** A row of vertical bars (single-hue magnitude), horizontally scrollable. */
function BarSeries({ points, currency }: { points: { day: string; value: number }[]; currency: string }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  return (
    <div className="flex h-32 items-end gap-0.5 overflow-x-auto">
      {points.map((p) => (
        <div
          key={p.day}
          title={`${p.day}: ${formatMoney(p.value, currency)}`}
          className="min-w-[6px] flex-1 rounded-t bg-brand-500"
          style={{ height: `${Math.max(2, (p.value / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

const CHURN_BADGE: Record<string, string> = {
  High: 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300',
  Medium: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
  Low: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  Unknown: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
};

export default function AnalyticsPage() {
  const { getToken } = useAuth();
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [message, setMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState('');
  const [recovery, setRecovery] = useState<RecoveryStats | null>(null);
  const [revenue, setRevenue] = useState<RevenueTrendResponse | null>(null);
  const [clv, setClv] = useState<ClvDistributionResponse | null>(null);
  const [cohorts, setCohorts] = useState<CohortResponse | null>(null);
  const [churn, setChurn] = useState<ChurnWatchlistResponse | null>(null);
  const [margin, setMargin] = useState<MarginResponse | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      setData(await getAnalyticsSummary(getToken));
      setStatus('ready');
    } catch (err) {
      setMessage((err as Error).message);
      setStatus('error');
      return;
    }
    // Deep-analytics sections load independently (one failing won't break others).
    getRecoveryStats(getToken).then(setRecovery).catch(() => setRecovery(null));
    getRevenueTrend(getToken).then(setRevenue).catch(() => setRevenue(null));
    getClvDistribution(getToken).then(setClv).catch(() => setClv(null));
    getCohorts(getToken).then(setCohorts).catch(() => setCohorts(null));
    getChurnWatchlist(getToken).then(setChurn).catch(() => setChurn(null));
    getMargin(getToken).then(setMargin).catch(() => setMargin(null));
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
  const maxSeg = data ? Math.max(1, ...data.distribution.map((d) => d.customers)) : 1;
  const maxClv = clv ? Math.max(1, ...clv.data.map((d) => d.customers)) : 1;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Analytics"
        subtitle="RFM, revenue, cohorts, CLV, churn & margin — from materialized views. Every chart ends in a reusable segment."
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

          {/* Revenue trend */}
          <Card title="Revenue trend" action={<span className="flex items-center gap-2 text-xs text-slate-400"><InfoTooltip metricKey="net_revenue" /><BuildSegment rule={PRESETS.highValue} label="Build high-value segment" /></span>}>
            {!revenue ? <Spinner /> : revenue.data.length === 0 ? (
              <EmptyState icon="📈" title="No revenue yet" description="Paid/fulfilled orders will appear here by day." />
            ) : (
              <>
                <BarSeries points={revenue.data.map((d) => ({ day: d.day, value: d.netRevenueMinor }))} currency={revenue.currency ?? currency} />
                <p className="mt-2 text-xs text-slate-400">{revenue.data.length} days · net of refunds, in your org timezone</p>
              </>
            )}
          </Card>

          {/* CLV distribution */}
          <Card title="CLV distribution" action={<span className="flex items-center gap-2 text-xs text-slate-400"><InfoTooltip metricKey="clv" /><BuildSegment rule={PRESETS.vip} label="Build VIP segment" /></span>}>
            {!clv ? <Spinner /> : clv.data.length === 0 ? (
              <EmptyState icon="💎" title="No CLV yet" description="Run a refresh to band customers by lifetime value." />
            ) : (
              <div className="space-y-2">
                {clv.data.map((d) => (
                  <div key={d.band} className="flex items-center gap-3 text-sm">
                    <span className="w-16 shrink-0 font-medium text-slate-700 dark:text-slate-300">{d.band}</span>
                    <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                      <div className="h-full rounded bg-brand-500" style={{ width: `${(d.customers / maxClv) * 100}%` }} />
                    </div>
                    <span className="w-14 shrink-0 text-right tabular-nums text-slate-600 dark:text-slate-400">{d.customers.toLocaleString()}</span>
                    <span className="w-28 shrink-0 text-right tabular-nums text-slate-500">{formatMoney(d.totalMinor, clv.currency ?? currency)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Cohort retention grid */}
          <Card title="Cohort retention" action={<span className="flex items-center gap-2 text-xs text-slate-400"><InfoTooltip metricKey="cohort" /><BuildSegment rule={PRESETS.winback} label="Build win-back segment" /></span>}>
            {!cohorts ? <Spinner /> : cohorts.data.length === 0 ? (
              <EmptyState icon="🗓️" title="No cohorts yet" description="Cohorts appear once customers have repeat purchases." />
            ) : (
              <div className="overflow-x-auto">
                <table className="text-xs">
                  <thead>
                    <tr className="text-slate-400">
                      <th className="px-2 py-1 text-left font-medium">Cohort</th>
                      <th className="px-2 py-1 text-right font-medium">Size</th>
                      {Array.from({ length: cohorts.maxPeriod + 1 }, (_, p) => (
                        <th key={p} className="px-2 py-1 text-center font-medium">M{p}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cohorts.data.map((row) => {
                      const byPeriod = new Map(row.cells.map((c) => [c.periodNumber, c.retentionPct]));
                      return (
                        <tr key={row.cohortMonth}>
                          <td className="px-2 py-1 font-medium text-slate-700 dark:text-slate-300">{row.cohortMonth.slice(0, 7)}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-slate-500">{row.cohortSize}</td>
                          {Array.from({ length: cohorts.maxPeriod + 1 }, (_, p) => {
                            const pct = byPeriod.get(p);
                            return (
                              <td
                                key={p}
                                className="px-2 py-1 text-center tabular-nums text-slate-700 dark:text-slate-200"
                                style={pct != null ? { backgroundColor: `rgba(59,130,246,${(pct / 100) * 0.8 + 0.08})` } : undefined}
                              >
                                {pct != null ? `${pct}%` : ''}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-slate-400">M0 = acquisition month; each cell = % of the cohort still ordering.</p>
              </div>
            )}
          </Card>

          {/* Churn watchlist */}
          <Card title="Churn watchlist" action={<span className="flex items-center gap-2 text-xs text-slate-400"><InfoTooltip metricKey="churn_risk" /><BuildSegment rule={PRESETS.saveAtRisk} label="Build save segment" /></span>}>
            {!churn ? <Spinner /> : churn.data.length === 0 ? (
              <EmptyState icon="🛟" title="No at-risk customers" description="High/Medium churn customers surface here, highest-CLV first." />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-800/50">
                    <tr>
                      <th className="px-3 py-2">Customer</th>
                      <th className="px-3 py-2">Email</th>
                      <th className="px-3 py-2">Churn</th>
                      <th className="px-3 py-2">CLV band</th>
                      <th className="px-3 py-2 text-right">CLV</th>
                      <th className="px-3 py-2 text-right">Days since</th>
                    </tr>
                  </thead>
                  <tbody>
                    {churn.data.map((r) => (
                      <tr key={r.customerId} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                        <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-100">{r.name}</td>
                        <td className="px-3 py-2 text-slate-500">{r.email ?? '—'}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${CHURN_BADGE[r.churnBand]}`}>{r.churnBand}</span>
                        </td>
                        <td className="px-3 py-2 text-slate-500">{r.clvBand ?? '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-400">{formatMoney(r.clvMinor, churn.currency ?? currency)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.daysSinceLast ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Contribution margin */}
          <Card title="Contribution margin" action={<span className="flex items-center gap-2 text-xs text-slate-400"><InfoTooltip metricKey="contribution_margin" /><BuildSegment rule={PRESETS.highValue} label="Build high-value segment" /></span>}>
            {!margin ? <Spinner /> : margin.data.length === 0 ? (
              <EmptyState icon="🧮" title="No margin yet" description="Margin appears once there are paid/fulfilled orders." />
            ) : (
              <>
                <div className="mb-2 flex items-baseline gap-3">
                  <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">{formatMoney(margin.totalMarginMinor, margin.currency ?? currency)}</span>
                  <span className={`text-xs font-medium ${margin.isEstimate ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'}`}>{margin.label}</span>
                </div>
                <BarSeries points={margin.data.map((d) => ({ day: d.day, value: d.marginMinor }))} currency={margin.currency ?? currency} />
                {margin.isEstimate && (
                  <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">⚠ Estimate excludes COGS — add per-SKU costs to compute true contribution margin.</p>
                )}
              </>
            )}
          </Card>

          {/* RFM segment distribution (existing) */}
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
                      <div className="h-full rounded bg-brand-500" style={{ width: `${(d.customers / maxSeg) * 100}%` }} />
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
