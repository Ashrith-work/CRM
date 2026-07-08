'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import type { OrgUser, Task } from '@crm/types';
import { listTasks, listUsers, type TaskListParams } from '@/lib/api';
import { Button, ErrorPanel, PageHeader, Spinner, actorName, formatDate } from '@/components/crm/ui';
import { PRIORITY_BADGE, STATUS_BADGE, TASK_TYPE_LABEL, isOverdue, relatedHref, taskAnchorIso } from '@/components/crm/taskUi';

const select = 'rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500';

export default function TasksPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [message, setMessage] = useState('');
  const [users, setUsers] = useState<OrgUser[]>([]);

  // Filters.
  const [bucket, setBucket] = useState('');
  const [type, setType] = useState('');
  const [assignee, setAssignee] = useState('me');
  const [search, setSearch] = useState('');
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setUsers((await listUsers(getToken)).data);
      } catch {
        /* directory is best-effort for the filter */
      }
    })();
  }, [getToken]);

  const load = useCallback(
    async (append: boolean) => {
      if (!append) setStatus('loading');
      try {
        const params: TaskListParams = {
          bucket: (bucket || undefined) as TaskListParams['bucket'],
          type: (type || undefined) as TaskListParams['type'],
          assigneeId: assignee || undefined,
          search: search || undefined,
          cursor: append && cursor ? cursor : undefined,
          limit: 25,
        };
        const page = await listTasks(getToken, params);
        setTasks((prev) => (append ? [...prev, ...page.data] : page.data));
        setCursor(page.nextCursor);
        setStatus('ready');
      } catch (err) {
        setMessage((err as Error).message);
        setStatus('error');
      }
    },
    [getToken, bucket, type, assignee, search, cursor],
  );

  // Debounced reload on filter/search change.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void load(false), 250);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket, type, assignee, search]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tasks"
        action={
          <Link href="/dashboard/tasks/new">
            <Button>New task</Button>
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tasks…"
          className="min-w-[12rem] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />
        <select value={bucket} onChange={(e) => setBucket(e.target.value)} className={select}>
          <option value="">When: All</option>
          <option value="overdue">Overdue</option>
          <option value="today">Today</option>
          <option value="upcoming">Upcoming</option>
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className={select}>
          <option value="">Type: All</option>
          <option value="TASK">Task</option>
          <option value="FOLLOW_UP">Follow-up</option>
          <option value="MEETING">Meeting</option>
          <option value="CALL">Call</option>
        </select>
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={select}>
          <option value="me">Assignee: Me</option>
          <option value="">Anyone</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {actorName(u)}
            </option>
          ))}
        </select>
      </div>

      {status === 'error' ? (
        <ErrorPanel message={message} onRetry={() => void load(false)} />
      ) : status === 'loading' ? (
        <Spinner />
      ) : tasks.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">No tasks match these filters.</p>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {tasks.map((t) => {
            const overdue = isOverdue(t);
            const anchor = taskAnchorIso(t);
            return (
              <li key={t.id}>
                <button
                  onClick={() => router.push(`/dashboard/tasks/${t.id}`)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
                >
                  <span className="w-16 shrink-0 text-xs font-medium uppercase tracking-wide text-slate-400">
                    {TASK_TYPE_LABEL[t.type]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-800">{t.title}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {t.related ? (
                        <span className="text-brand-600" onClick={(e) => { e.stopPropagation(); router.push(relatedHref(t.related!.type, t.related!.id)); }}>
                          {t.related.label}
                        </span>
                      ) : (
                        '—'
                      )}
                      {' · '}
                      {actorName(t.assignee)}
                    </span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${PRIORITY_BADGE[t.priority]}`}>
                    {t.priority}
                  </span>
                  <span className={`w-40 shrink-0 text-right text-xs ${overdue ? 'font-semibold text-red-600' : 'text-slate-500'}`}>
                    {anchor ? formatDate(anchor) : 'No date'}
                    {overdue && ' · overdue'}
                  </span>
                  <span className={`w-20 shrink-0 rounded-full px-2 py-0.5 text-center text-xs font-semibold ${STATUS_BADGE[t.status]}`}>
                    {t.status}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {status === 'ready' && cursor && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={() => void load(true)}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
