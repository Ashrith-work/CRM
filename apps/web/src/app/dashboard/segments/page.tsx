'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import type { Segment } from '@crm/types';
import { listSegments } from '@/lib/api';
import { Card, PageHeader, Button, Spinner, ErrorPanel, formatDate } from '@/components/crm/ui';
import { EmptyState } from '@/components/crm/EmptyState';

function TypeBadge({ type }: { type: 'STATIC' | 'DYNAMIC' }) {
  const cls = type === 'DYNAMIC' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{type}</span>;
}

export default function SegmentsPage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const [segments, setSegments] = useState<Segment[]>([]);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const res = await listSegments(getToken);
      setSegments(res.data);
      setStatus('ready');
    } catch (err) {
      setMessage((err as Error).message);
      setStatus('error');
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Segments"
        subtitle="Rule-based audiences over customer features — reuse as a campaign target."
        action={
          <Link href="/dashboard/segments/new">
            <Button>New segment</Button>
          </Link>
        }
      />

      {status === 'loading' ? (
        <Spinner />
      ) : status === 'error' ? (
        <ErrorPanel message={message} onRetry={load} />
      ) : segments.length === 0 ? (
        <EmptyState
          icon="🎯"
          title="No segments yet"
          description="Build a rule-tree audience (e.g. Champions with 3+ orders) and save it."
          action={
            <Link href="/dashboard/segments/new">
              <Button>New segment</Button>
            </Link>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {segments.map((s) => (
            <button key={s.id} onClick={() => router.push(`/dashboard/segments/${s.id}`)} className="text-left">
              <Card>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-800 dark:text-slate-100">{s.name}</p>
                    {s.description && <p className="mt-0.5 text-sm text-slate-500">{s.description}</p>}
                  </div>
                  <TypeBadge type={s.type} />
                </div>
                <div className="mt-3 flex items-center justify-between text-sm text-slate-500">
                  <span>
                    <span className="text-lg font-bold text-slate-800 dark:text-slate-100">{s.memberCount.toLocaleString()}</span> members
                  </span>
                  <span>{s.lastRefreshedAt ? `refreshed ${formatDate(s.lastRefreshedAt)}` : 'never refreshed'}</span>
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
