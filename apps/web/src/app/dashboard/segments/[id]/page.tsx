'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import type { Segment, SegmentSampleRow } from '@crm/types';
import { getSegment, getSegmentMembers, refreshSegment } from '@/lib/api';
import { Card, PageHeader, Button, Row, Spinner, ErrorPanel, formatDate, formatMoney } from '@/components/crm/ui';
import { EmptyState } from '@/components/crm/EmptyState';

export default function SegmentDetailPage() {
  const { getToken } = useAuth();
  const { id } = useParams<{ id: string }>();
  const [segment, setSegment] = useState<Segment | null>(null);
  const [members, setMembers] = useState<SegmentSampleRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [message, setMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const loadMembers = useCallback(
    async (append: boolean, nextCursor?: string) => {
      const res = await getSegmentMembers(getToken, id, { cursor: append ? nextCursor : undefined, limit: 50 });
      setMembers((prev) => (append ? [...prev, ...res.data] : res.data));
      setCursor(res.nextCursor);
    },
    [getToken, id],
  );

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      setSegment(await getSegment(getToken, id));
      await loadMembers(false);
      setStatus('ready');
    } catch (err) {
      setMessage((err as Error).message);
      setStatus('error');
    }
  }, [getToken, id, loadMembers]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      setSegment(await refreshSegment(getToken, id));
      await loadMembers(false);
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  if (status === 'loading') return <Spinner />;
  if (status === 'error' || !segment) return <ErrorPanel message={message} onRetry={load} />;

  return (
    <div className="space-y-4">
      <PageHeader
        title={segment.name}
        subtitle={segment.description ?? undefined}
        action={
          segment.type === 'DYNAMIC' ? (
            <Button variant="secondary" onClick={onRefresh} disabled={refreshing}>
              {refreshing ? 'Refreshing…' : 'Refresh membership'}
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Overview">
          <Row label="Type" value={segment.type} />
          <Row label="Members" value={segment.memberCount.toLocaleString()} />
          <Row label="Last refreshed" value={segment.lastRefreshedAt ? formatDate(segment.lastRefreshedAt) : '—'} />
          {segment.refreshCron && <Row label="Cron" value={segment.refreshCron} />}
        </Card>
        <Card title="Campaign audience">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Reuse this segment as a campaign audience — consumed in M4. {segment.memberCount.toLocaleString()} customers are currently in scope.
          </p>
        </Card>
      </div>

      <Card title={`Members (${segment.memberCount.toLocaleString()})`}>
        {members.length === 0 ? (
          <EmptyState icon="👥" title="No members" description="This segment matches no customers right now." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-800/50">
                <tr>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Segment</th>
                  <th className="px-3 py-2 text-right">Net revenue</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.customerId} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                    <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-100">{m.name}</td>
                    <td className="px-3 py-2 text-slate-500">{m.email ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-500">{m.rSegment ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-400">{formatMoney(m.netRevenueMinor, 'INR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {cursor && (
          <div className="mt-3 flex justify-center">
            <Button variant="secondary" onClick={() => loadMembers(true, cursor)}>
              Load more
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
