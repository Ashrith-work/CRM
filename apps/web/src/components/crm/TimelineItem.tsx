'use client';

import type { TimelineItem as TimelineItemType } from '@crm/types';
import { formatDate } from './ui';

const TYPE_META: Record<TimelineItemType['type'], { dot: string; icon: string }> = {
  order: { dot: 'bg-brand-500', icon: '🛍️' },
  event: { dot: 'bg-sky-500', icon: '👣' },
  message: { dot: 'bg-violet-500', icon: '✉️' },
  call: { dot: 'bg-emerald-500', icon: '📞' },
  ticket: { dot: 'bg-amber-500', icon: '🎫' },
  note: { dot: 'bg-slate-400', icon: '📝' },
  return: { dot: 'bg-red-500', icon: '↩️' },
};

/** One row of the unified customer timeline. */
export function TimelineItem({ item }: { item: TimelineItemType }) {
  const meta = TYPE_META[item.type] ?? TYPE_META.note;
  return (
    <li className="flex gap-3">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
      <div className="min-w-0 text-sm">
        <p className="text-slate-800 dark:text-slate-100">
          <span className="mr-1">{meta.icon}</span>
          <span className="font-medium capitalize">{item.type}</span>
          {item.summary ? <span className="text-slate-600 dark:text-slate-300"> · {item.summary}</span> : null}
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500">{formatDate(item.occurredAt)}</p>
      </div>
    </li>
  );
}
