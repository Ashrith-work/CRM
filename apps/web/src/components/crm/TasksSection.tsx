'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import type { RelatedType, Task } from '@crm/types';
import { listTasks } from '@/lib/api';
import { Card, formatDate } from './ui';
import { STATUS_BADGE, TASK_TYPE_LABEL, isOverdue } from './taskUi';

/** Follow-ups & tasks linked to a CRM record, shown on its detail page. */
export function TasksSection({
  relatedType,
  relatedId,
  relatedLabel,
}: {
  relatedType: RelatedType;
  relatedId: string;
  relatedLabel?: string;
}) {
  const { getToken } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await listTasks(getToken, { relatedType, relatedId, limit: 50 });
      setTasks(res.data);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [getToken, relatedType, relatedId]);

  useEffect(() => {
    void load();
  }, [load]);

  const query = new URLSearchParams({
    relatedType,
    relatedId,
    type: 'FOLLOW_UP',
    ...(relatedLabel ? { relatedLabel } : {}),
  }).toString();

  const openTasks = tasks.filter((t) => t.status === 'OPEN');

  return (
    <Card
      title={`Follow-ups & tasks (${openTasks.length} open)`}
      action={
        <Link href={`/dashboard/tasks/new?${query}`} className="text-sm font-medium text-brand-600 hover:underline">
          + Schedule follow-up
        </Link>
      }
    >
      {error && <p className="text-sm text-red-600">{error}</p>}
      {tasks.length === 0 ? (
        <p className="text-sm text-slate-400">No tasks yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 py-2">
              <Link href={`/dashboard/tasks/${t.id}`} className="min-w-0 flex-1 truncate text-sm text-brand-600 hover:underline">
                <span className="text-xs uppercase tracking-wide text-slate-400">{TASK_TYPE_LABEL[t.type]}</span> {t.title}
              </Link>
              <span className={`shrink-0 text-xs ${isOverdue(t) ? 'font-semibold text-red-600' : 'text-slate-500'}`}>
                {t.dueAt || t.startAt ? formatDate((t.startAt ?? t.dueAt)!) : '—'}
              </span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[t.status]}`}>{t.status}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
