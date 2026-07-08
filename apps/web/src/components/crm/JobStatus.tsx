'use client';

import type { SyncJobStatus } from '@crm/types';
import { formatDate } from './ui';

const STATE_BADGE: Record<SyncJobStatus['state'], string> = {
  idle: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  running: 'bg-brand-50 text-brand-700 dark:bg-brand-950/50 dark:text-brand-300',
  completed: 'bg-green-50 text-green-700 dark:bg-green-950/50 dark:text-green-400',
  failed: 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-400',
};

const STATE_LABEL: Record<SyncJobStatus['state'], string> = {
  idle: 'Idle',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
};

/** Renders a Shopify sync-job's live status (used in the Settings panel). */
export function JobStatus({ sync }: { sync: SyncJobStatus | null }) {
  if (!sync) {
    return <p className="text-sm text-slate-400 dark:text-slate-500">No sync has run yet.</p>;
  }

  const counts =
    sync.processed || sync.total
      ? `${sync.processed.toLocaleString()}${sync.total ? ` / ${sync.total.toLocaleString()}` : ''}`
      : null;

  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATE_BADGE[sync.state]}`}>
          {STATE_LABEL[sync.state]}
        </span>
        {sync.phase && <span className="text-slate-600 dark:text-slate-300">{sync.phase}</span>}
        {counts && <span className="text-slate-500 dark:text-slate-400">· {counts} processed</span>}
      </div>

      {sync.state === 'running' && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-brand-500" />
        </div>
      )}

      <div className="text-xs text-slate-400 dark:text-slate-500">
        {sync.startedAt && <>Started {formatDate(sync.startedAt)}</>}
        {sync.finishedAt && <> · Finished {formatDate(sync.finishedAt)}</>}
      </div>

      {sync.error && <p className="text-xs text-red-600 dark:text-red-400">{sync.error}</p>}
    </div>
  );
}
