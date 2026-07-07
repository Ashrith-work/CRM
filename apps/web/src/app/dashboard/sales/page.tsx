'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import type {
  FunnelResponse,
  Pipeline,
  SalesTiles,
  TeamResponse,
  TrendInterval,
  TrendMetric,
  TrendsResponse,
} from '@crm/types';
import {
  getFunnel,
  getSalesTiles,
  getTeam,
  getTrends,
  listPipelines,
  type DashboardPeriodParams,
} from '@/lib/api';
import { Card, ErrorPanel, PageHeader, Spinner, formatMoney } from '@/components/crm/ui';
import { MetricGrid, MetricTile, Money, percent } from '@/components/crm/MetricTile';
import { FunnelChart } from '@/components/crm/FunnelChart';
import { TrendsChart } from '@/components/crm/TrendsChart';

type Preset = NonNullable<DashboardPeriodParams['period']>;

const PRESETS: Array<{ value: Preset; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'quarter', label: 'This quarter' },
  { value: 'custom', label: 'Custom' },
];

export default function SalesDashboardPage() {
  const { getToken } = useAuth();

  // Filters.
  const [preset, setPreset] = useState<Preset>('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [pipelineId, setPipelineId] = useState('');
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);

  // Trends controls.
  const [metric, setMetric] = useState<TrendMetric>('won');
  const [interval, setIntervalState] = useState<TrendInterval>('month');

  // Data.
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [message, setMessage] = useState('');
  const [tiles, setTiles] = useState<SalesTiles | null>(null);
  const [funnel, setFunnel] = useState<FunnelResponse | null>(null);
  const [team, setTeam] = useState<TeamResponse | null>(null);
  const [trends, setTrends] = useState<TrendsResponse | null>(null);

  const periodParams: DashboardPeriodParams = useMemo(
    () => ({ period: preset, ...(preset === 'custom' ? { from, to } : {}) }),
    [preset, from, to],
  );
  // A custom range is only valid once both dates are set.
  const periodReady = preset !== 'custom' || (Boolean(from) && Boolean(to));
  const funnelPipelineId = pipelineId || pipelines[0]?.id || '';

  // Load pipelines once.
  useEffect(() => {
    void (async () => {
      const token = await getToken();
      if (!token) return;
      try {
        const res = await listPipelines(token);
        setPipelines(res.data);
      } catch {
        /* pipeline filter is optional */
      }
    })();
  }, [getToken]);

  const load = useCallback(async () => {
    if (!periodReady) return;
    setStatus('loading');
    try {
      const token = await getToken();
      if (!token) throw new Error('No session token available');
      const pipeParam = pipelineId ? { pipelineId } : {};

      const [tilesRes, funnelRes] = await Promise.all([
        getSalesTiles(token, { ...periodParams, ...pipeParam }),
        funnelPipelineId
          ? getFunnel(token, { ...periodParams, pipelineId: funnelPipelineId })
          : Promise.resolve(null),
      ]);
      setTiles(tilesRes);
      setFunnel(funnelRes);

      // Team is manager/owner-only — reps get 403; hide the section silently.
      try {
        setTeam(await getTeam(token, periodParams));
      } catch {
        setTeam(null);
      }
      setStatus('ready');
    } catch (err) {
      setMessage((err as Error).message);
      setStatus('error');
    }
  }, [getToken, periodParams, periodReady, pipelineId, funnelPipelineId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Trends load independently (its own metric/interval controls).
  const loadTrends = useCallback(async () => {
    if (!periodReady) return;
    const token = await getToken();
    if (!token) return;
    try {
      const pipeParam = pipelineId ? { pipelineId } : {};
      setTrends(await getTrends(token, { ...periodParams, metric, interval, ...pipeParam }));
    } catch {
      setTrends(null);
    }
  }, [getToken, periodParams, periodReady, pipelineId, metric, interval]);

  useEffect(() => {
    void loadTrends();
  }, [loadTrends]);

  const isEmpty =
    tiles !== null &&
    tiles.pipelineValue.length === 0 &&
    tiles.dealsWon === 0 &&
    tiles.dealsCreated === 0;

  const inputClass = 'rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500';

  return (
    <div className="space-y-5">
      <PageHeader
        title="Sales dashboard"
        subtitle={tiles ? `Scope: ${scopeLabel(tiles.scope)} · ${tiles.period.timezone}` : undefined}
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={preset} onChange={(e) => setPreset(e.target.value as Preset)} className={inputClass}>
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        {preset === 'custom' && (
          <>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
            <span className="text-slate-400">→</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} />
          </>
        )}
        <select value={pipelineId} onChange={(e) => setPipelineId(e.target.value)} className={inputClass}>
          <option value="">All pipelines</option>
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {!periodReady ? (
        <Card>
          <p className="text-sm text-slate-500">Pick a start and end date for the custom range.</p>
        </Card>
      ) : status === 'loading' ? (
        <Spinner />
      ) : status === 'error' ? (
        <ErrorPanel message={message} onRetry={() => void load()} />
      ) : isEmpty ? (
        <Card>
          <div className="py-8 text-center">
            <p className="text-sm font-medium text-slate-700">No deals yet</p>
            <p className="mt-1 text-sm text-slate-500">Create a deal to see your sales metrics.</p>
            <Link
              href="/dashboard/deals/new"
              className="mt-4 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              New deal
            </Link>
          </div>
        </Card>
      ) : (
        tiles && (
          <>
            {/* Tiles */}
            <MetricGrid>
              <MetricTile label="Pipeline value" value={<Money value={tiles.pipelineValue} />} />
              <MetricTile label="Weighted pipeline" value={<Money value={tiles.weightedPipeline} />} />
              <MetricTile
                label="Deals won"
                value={tiles.dealsWon}
                sub={<Money value={tiles.revenueWon} />}
              />
              <MetricTile label="Win rate" value={percent(tiles.winRate)} sub={`${tiles.dealsLost} lost`} />
              <MetricTile label="Avg deal size" value={<Money value={tiles.avgDealSize} />} />
              <MetricTile label="Deals created" value={tiles.dealsCreated} />
              <MetricTile label="Activities logged" value={tiles.activitiesLogged} />
              <MetricTile label="Tasks overdue" value={tiles.tasksOverdue} />
              <MetricTile label="Tasks done" value={tiles.tasksDone} />
            </MetricGrid>

            {/* Funnel */}
            <Card title="Funnel (deals that passed through each stage)">
              {funnel ? (
                <FunnelChart funnel={funnel} />
              ) : (
                <p className="text-sm text-slate-400">No pipeline to chart — create a pipeline first.</p>
              )}
            </Card>

            {/* Trends */}
            <Card title="Trends">
              {trends ? (
                <TrendsChart trends={trends} onMetricChange={setMetric} onIntervalChange={setIntervalState} />
              ) : (
                <Spinner label="Loading trends…" />
              )}
            </Card>

            {/* Team (managers/owner only) */}
            {team && (
              <Card title="Team performance">
                <TeamTable team={team} />
              </Card>
            )}
          </>
        )
      )}
    </div>
  );
}

function TeamTable({ team }: { team: TeamResponse }) {
  if (team.reps.length === 0) {
    return <p className="text-sm text-slate-400">No team members to show.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2 font-semibold">Rep</th>
            <th className="px-3 py-2 font-semibold">Pipeline</th>
            <th className="px-3 py-2 font-semibold">Won</th>
            <th className="px-3 py-2 font-semibold">Win rate</th>
            <th className="px-3 py-2 font-semibold">Activities</th>
            <th className="px-3 py-2 font-semibold">Tasks done</th>
          </tr>
        </thead>
        <tbody>
          {team.reps.map((r) => (
            <tr key={r.userId} className="border-b border-slate-100 last:border-0">
              <td className="px-3 py-2 font-medium text-slate-800">{r.name}</td>
              <td className="px-3 py-2">
                {r.pipelineValue.length ? (
                  r.pipelineValue.map((m) => (
                    <div key={m.currency}>{formatMoney(m.amountMinor, m.currency)}</div>
                  ))
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </td>
              <td className="px-3 py-2">{r.dealsWon}</td>
              <td className="px-3 py-2">{percent(r.winRate)}</td>
              <td className="px-3 py-2">{r.activities}</td>
              <td className="px-3 py-2">{r.tasksCompleted}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function scopeLabel(scope: SalesTiles['scope']): string {
  return scope === 'all' ? 'organization' : scope === 'team' ? 'team' : 'you';
}
