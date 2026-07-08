'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import type { Campaign, Enrollment, RecoveryStats } from '@crm/types';
import { getCampaigns, getRecoveryStats, getCampaignEnrollments, runCampaigns } from '@/lib/api';
import { Card, PageHeader, Button, Spinner, ErrorPanel, formatDate, dateOnly, formatMoney } from '@/components/crm/ui';
import { MetricGrid } from '@/components/crm/MetricTile';
import { InfoTooltip } from '@/components/crm/InfoTooltip';
import { EmptyState } from '@/components/crm/EmptyState';
import { ChannelBadge, SendStatusBadge, EnrollmentStatusBadge, humanizeDelay } from '@/components/crm/ChannelBadge';

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

function StatusBadge({ status }: { status: 'ACTIVE' | 'PAUSED' }) {
  const cls = status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}

export default function CampaignsPage() {
  const { getToken } = useAuth();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [stats, setStats] = useState<RecoveryStats | null>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [message, setMessage] = useState('');
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const [c, s] = await Promise.all([getCampaigns(getToken), getRecoveryStats(getToken)]);
      setCampaigns(c.data);
      setStats(s);
      if (c.data[0]) {
        const e = await getCampaignEnrollments(getToken, c.data[0].id, { limit: 20 });
        setEnrollments(e.data);
        setCursor(e.nextCursor);
      } else {
        setEnrollments([]);
        setCursor(null);
      }
      setStatus('ready');
    } catch (err) {
      setMessage((err as Error).message);
      setStatus('error');
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    if (!cursor || !campaigns[0]) return;
    const e = await getCampaignEnrollments(getToken, campaigns[0].id, { cursor, limit: 20 });
    setEnrollments((prev) => [...prev, ...e.data]);
    setCursor(e.nextCursor);
  };

  const onRun = async () => {
    setRunning(true);
    setNote('');
    try {
      const res = await runCampaigns(getToken);
      setNote(`Sweep ran — enrolled ${res.enrolled}, sent ${res.sent}.`);
      await load();
    } catch (err) {
      setNote((err as Error).message.includes('403') ? 'Only admins can trigger a sweep.' : (err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const currency = stats?.currency ?? 'INR';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Recovery campaigns"
        subtitle="Abandoned-cart recovery — a consent-gated email sequence that halts on purchase."
        action={
          <Button variant="secondary" onClick={onRun} disabled={running}>
            {running ? 'Running…' : 'Run sweep now'}
          </Button>
        }
      />
      {note && <p className="text-sm text-amber-600 dark:text-amber-400">{note}</p>}

      {status === 'loading' ? (
        <Spinner />
      ) : status === 'error' ? (
        <ErrorPanel message={message} onRetry={load} />
      ) : (
        <>
          {stats && (
            <>
              <MetricGrid>
                <Tile label="Recovery rate" value={`${(stats.recoveryRate * 100).toFixed(1)}%`} sub={`${stats.recoveredCarts} of ${stats.abandonedCarts} carts`} metricKey="recovery_rate" />
                <Tile label="Carts recovered" value={`${stats.recoveredCarts.toLocaleString()}`} sub={`${stats.abandonedCarts.toLocaleString()} abandoned`} />
                <Tile label="Recovered revenue" value={formatMoney(stats.recoveredRevenueMinor, currency)} metricKey="recovered_revenue" />
              </MetricGrid>
              <p className="text-xs text-slate-500">
                Sends — {stats.sends.sent} sent · {stats.sends.opened} opened · {stats.sends.blocked} blocked · {stats.sends.bounced} bounced · {stats.sends.delayed} delayed
                {stats.lastRefreshedAt ? ` · updated ${formatDate(stats.lastRefreshedAt)}` : ''}
              </p>
            </>
          )}

          {campaigns.length === 0 ? (
            <EmptyState icon="🛒" title="No campaigns yet" description="An abandoned-cart recovery campaign will appear here once configured." />
          ) : (
            campaigns.map((c) => (
              <Card key={c.id}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-100">
                      {c.name} <StatusBadge status={c.status} /> <ChannelBadge channel={c.channel} />
                    </p>
                    <p className="mt-0.5 text-sm text-slate-500">
                      {c.enrollmentCount} enrolled · {c.activeCount} active · {c.sentCount} sent · {c.recoveredCount} recovered
                    </p>
                  </div>
                </div>
                <div className="mt-3 space-y-1.5">
                  {c.steps.map((s) => (
                    <div key={s.id} className="flex items-center gap-3 text-sm">
                      <span className="w-12 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-center text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        T+{humanizeDelay(s.delayMinutes)}
                      </span>
                      <span className="truncate text-slate-700 dark:text-slate-300">{s.subject}</span>
                      <span className="ml-auto shrink-0 text-xs text-slate-400">v{s.templateVersion}</span>
                    </div>
                  ))}
                </div>
              </Card>
            ))
          )}

          {campaigns.length > 0 && (
            <Card title="Enrollments">
              {enrollments.length === 0 ? (
                <EmptyState icon="📭" title="No enrollments yet" description="Abandoned carts (older than the threshold, consented) get enrolled by the sweep." />
              ) : (
                <div className="space-y-2">
                  {enrollments.map((e) => (
                    <div key={e.id} className="flex flex-wrap items-center gap-2 border-b border-slate-100 py-2 text-sm last:border-0 dark:border-slate-800">
                      <span className="w-48 shrink-0 truncate font-medium text-slate-700 dark:text-slate-300">{e.email ?? '—'}</span>
                      <EnrollmentStatusBadge status={e.status} />
                      <span className="text-xs text-slate-400">abandoned {dateOnly(e.checkoutStartedAt)}</span>
                      {e.haltReason && <span className="text-xs text-amber-600 dark:text-amber-400">{e.haltReason}</span>}
                      <div className="ml-auto flex flex-wrap items-center gap-1.5">
                        {e.sends.map((s) => (
                          <span key={s.id} className="inline-flex items-center gap-1" title={s.blockedReason ?? undefined}>
                            <ChannelBadge channel={s.channel} />
                            <SendStatusBadge status={s.status} />
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                  {cursor && (
                    <div className="pt-2 text-center">
                      <Button variant="secondary" onClick={loadMore}>
                        Load more
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
