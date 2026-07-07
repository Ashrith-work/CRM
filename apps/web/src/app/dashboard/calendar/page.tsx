'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import type { Task } from '@crm/types';
import { listTasks } from '@/lib/api';
import { Button, ErrorPanel, PageHeader, Spinner } from '@/components/crm/ui';
import { TASK_TYPE_LABEL, taskAnchorIso } from '@/components/crm/taskUi';

type View = 'month' | 'week' | 'day';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** The [start, end) window of days rendered for a given view + anchor date. */
function windowFor(view: View, anchor: Date): { start: Date; days: number } {
  if (view === 'day') return { start: startOfDay(anchor), days: 1 };
  if (view === 'week') return { start: addDays(anchor, -anchor.getDay()), days: 7 };
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  return { start: addDays(first, -first.getDay()), days: 42 };
}

export default function CalendarPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [view, setView] = useState<View>('month');
  const [anchor, setAnchor] = useState(() => new Date());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [message, setMessage] = useState('');

  const { start, days } = useMemo(() => windowFor(view, anchor), [view, anchor]);
  const end = useMemo(() => addDays(start, days), [start, days]);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const page = await listTasks(getToken, {
        from: start.toISOString(),
        to: end.toISOString(),
        bucket: 'all',
        limit: 100,
      });
      setTasks(page.data);
      setStatus('ready');
    } catch (err) {
      setMessage((err as Error).message);
      setStatus('error');
    }
  }, [getToken, start, end]);

  useEffect(() => {
    void load();
  }, [load]);

  // Group tasks by local day of their anchor (meeting start / due date).
  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      const iso = taskAnchorIso(t);
      if (!iso) continue;
      const key = dayKey(new Date(iso));
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    return map;
  }, [tasks]);

  const step = (dir: number) => {
    if (view === 'day') setAnchor((a) => addDays(a, dir));
    else if (view === 'week') setAnchor((a) => addDays(a, dir * 7));
    else setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + dir, 1));
  };

  const title = anchor.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    ...(view !== 'month' ? { day: 'numeric' } : {}),
  });

  const cells = Array.from({ length: days }, (_, i) => addDays(start, i));
  const today = dayKey(new Date());

  const TaskChip = ({ t }: { t: Task }) => (
    <button
      onClick={() => router.push(`/dashboard/tasks/${t.id}`)}
      className="block w-full truncate rounded bg-brand-50 px-1.5 py-0.5 text-left text-[11px] text-brand-700 hover:bg-brand-100"
      title={`${TASK_TYPE_LABEL[t.type]}: ${t.title}`}
    >
      {t.startAt || t.dueAt ? new Date(taskAnchorIso(t)!).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : ''}{' '}
      {t.title}
    </button>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Calendar"
        action={
          <div className="flex gap-1 rounded-lg border border-slate-300 p-0.5">
            {(['month', 'week', 'day'] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-md px-3 py-1 text-sm font-medium capitalize ${view === v ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {v}
              </button>
            ))}
          </div>
        }
      />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => step(-1)}>
            ‹
          </Button>
          <Button variant="secondary" onClick={() => setAnchor(new Date())}>
            Today
          </Button>
          <Button variant="secondary" onClick={() => step(1)}>
            ›
          </Button>
        </div>
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>

      {status === 'error' ? (
        <ErrorPanel message={message} onRetry={() => void load()} />
      ) : status === 'loading' ? (
        <Spinner />
      ) : view === 'day' ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">
            {anchor.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
          </h3>
          <div className="space-y-1">
            {(byDay.get(dayKey(anchor)) ?? []).length === 0 ? (
              <p className="text-sm text-slate-400">Nothing scheduled.</p>
            ) : (
              (byDay.get(dayKey(anchor)) ?? []).map((t) => <TaskChip key={t.id} t={t} />)
            )}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="grid grid-cols-7 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {DOW.map((d) => (
              <div key={d} className="border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-center text-xs font-semibold text-slate-500">
                {d}
              </div>
            ))}
            {cells.map((d) => {
              const inMonth = view === 'week' || d.getMonth() === anchor.getMonth();
              const dayTasks = byDay.get(dayKey(d)) ?? [];
              return (
                <div
                  key={dayKey(d)}
                  className={`min-h-[90px] border-b border-r border-slate-100 p-1 ${inMonth ? '' : 'bg-slate-50/60'}`}
                >
                  <div className={`mb-1 text-right text-xs ${dayKey(d) === today ? 'font-bold text-brand-600' : 'text-slate-400'}`}>
                    {d.getDate()}
                  </div>
                  <div className="space-y-0.5">
                    {dayTasks.slice(0, 4).map((t) => (
                      <TaskChip key={t.id} t={t} />
                    ))}
                    {dayTasks.length > 4 && <p className="text-[10px] text-slate-400">+{dayTasks.length - 4} more</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
