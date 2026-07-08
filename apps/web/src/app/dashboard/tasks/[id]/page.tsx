'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import type { OrgUser, Task } from '@crm/types';
import {
  cancelTask,
  completeTask,
  deleteTask,
  getTask,
  listUsers,
  reassignTask,
  rescheduleTask,
  snoozeTask,
  type TokenGetter,
} from '@/lib/api';
import { Button, Card, ErrorPanel, PageHeader, Row, Spinner, actorName, formatDate } from '@/components/crm/ui';
import { Timeline } from '@/components/crm/Timeline';
import { PRIORITY_BADGE, STATUS_BADGE, TASK_TYPE_LABEL, isOverdue, relatedHref, taskAnchorIso } from '@/components/crm/taskUi';

const input = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500';

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function TaskDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { getToken } = useAuth();
  const [task, setTask] = useState<Task | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [timelineKey, setTimelineKey] = useState(0);

  // Action-panel state.
  const [panel, setPanel] = useState<'' | 'complete' | 'reschedule' | 'snooze' | 'reassign'>('');
  const [outcome, setOutcome] = useState('');
  const [when, setWhen] = useState('');
  const [assignee, setAssignee] = useState('');

  const load = useCallback(async () => {
    try {
      const t = await getTask(getToken, id);
      setTask(t);
      setOutcome(t.outcome ?? '');
      setWhen(toLocalInput(taskAnchorIso(t)));
      setAssignee(t.assigneeId);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [getToken, id]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void (async () => {
      if (getToken) setUsers((await listUsers(getToken)).data);
    })();
  }, [getToken]);

  const run = async (fn: (getToken: TokenGetter) => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn(getToken);
      setPanel('');
      await load();
      setTimelineKey((k) => k + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm('Delete this task?')) return;
    await deleteTask(getToken, id);
    router.push('/dashboard/tasks');
  };

  if (error && !task) return <ErrorPanel message={error} onRetry={() => void load()} />;
  if (!task) return <Spinner />;

  const anchor = taskAnchorIso(task);
  const open = task.status === 'OPEN';

  return (
    <div className="space-y-4">
      <PageHeader
        title={task.title}
        subtitle={TASK_TYPE_LABEL[task.type]}
        action={
          <div className="flex gap-2">
            <Link href={`/dashboard/tasks/${id}/edit`}>
              <Button variant="secondary">Edit</Button>
            </Link>
            <Button variant="danger" onClick={() => void remove()}>
              Delete
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_BADGE[task.status]}`}>{task.status}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${PRIORITY_BADGE[task.priority]}`}>{task.priority}</span>
        {isOverdue(task) && <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700">Overdue</span>}
      </div>

      {open && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setPanel(panel === 'complete' ? '' : 'complete')}>Complete</Button>
          <Button variant="secondary" onClick={() => setPanel(panel === 'reschedule' ? '' : 'reschedule')}>
            Reschedule
          </Button>
          <Button variant="secondary" onClick={() => setPanel(panel === 'snooze' ? '' : 'snooze')}>
            Snooze
          </Button>
          <Button variant="secondary" onClick={() => setPanel(panel === 'reassign' ? '' : 'reassign')}>
            Reassign
          </Button>
          <Button variant="secondary" onClick={() => void run((t) => cancelTask(t, id))}>
            Cancel task
          </Button>
        </div>
      )}

      {panel === 'complete' && (
        <Card title="Complete task">
          <textarea
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            rows={3}
            placeholder="Outcome (optional)…"
            className={input}
          />
          <div className="mt-3">
            <Button disabled={busy} onClick={() => void run((t) => completeTask(t, id, { outcome: outcome || undefined }))}>
              Mark done
            </Button>
          </div>
        </Card>
      )}
      {panel === 'reschedule' && (
        <Card title="Reschedule">
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={input} />
          <div className="mt-3">
            <Button
              disabled={busy}
              onClick={() =>
                void run((t) =>
                  task.type === 'MEETING'
                    ? rescheduleTask(t, id, { startAt: when ? new Date(when).toISOString() : null })
                    : rescheduleTask(t, id, { dueAt: when ? new Date(when).toISOString() : null }),
                )
              }
            >
              Save date
            </Button>
          </div>
        </Card>
      )}
      {panel === 'snooze' && (
        <Card title="Snooze reminder">
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={input} />
          <div className="mt-3">
            <Button
              disabled={busy || !when}
              onClick={() => void run((t) => snoozeTask(t, id, { remindAt: new Date(when).toISOString() }))}
            >
              Snooze until
            </Button>
          </div>
        </Card>
      )}
      {panel === 'reassign' && (
        <Card title="Reassign">
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={input}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {actorName(u)}
              </option>
            ))}
          </select>
          <div className="mt-3">
            <Button disabled={busy} onClick={() => void run((t) => reassignTask(t, id, { assigneeId: assignee }))}>
              Reassign
            </Button>
          </div>
        </Card>
      )}

      {error && <ErrorPanel message={error} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Details">
          {task.description && <p className="mb-3 whitespace-pre-wrap text-sm text-slate-700">{task.description}</p>}
          <Row label={task.type === 'MEETING' ? 'Starts' : 'Due'} value={anchor ? formatDate(anchor) : '—'} />
          {task.type === 'MEETING' && <Row label="Ends" value={task.endAt ? formatDate(task.endAt) : '—'} />}
          {task.location && <Row label="Location" value={task.location} />}
          {task.meetingUrl && (
            <Row
              label="Meeting"
              value={
                <a href={task.meetingUrl} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
                  Join
                </a>
              }
            />
          )}
          <Row label="Assignee" value={actorName(task.assignee)} />
          <Row label="Created by" value={actorName(task.createdBy)} />
          <Row
            label="Related"
            value={
              task.related ? (
                <Link href={relatedHref(task.related.type, task.related.id)} className="text-brand-600 hover:underline">
                  {task.related.label}
                </Link>
              ) : (
                '—'
              )
            }
          />
          {task.completedAt && <Row label="Completed" value={formatDate(task.completedAt)} />}
          {task.outcome && <Row label="Outcome" value={task.outcome} />}
        </Card>

        <Card title="Reminders">
          {task.reminders.length === 0 ? (
            <p className="text-sm text-slate-400">No reminders scheduled.</p>
          ) : (
            <ul className="space-y-2">
              {task.reminders.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-slate-700">{formatDate(r.remindAt)}</span>
                  <span className="text-xs text-slate-400">{r.channels.join(', ')}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      r.status === 'SENT' ? 'bg-green-50 text-green-700' : r.status === 'CANCELLED' ? 'bg-slate-100 text-slate-500' : 'bg-brand-50 text-brand-700'
                    }`}
                  >
                    {r.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {task.related && (
          <Card title={`Activity · ${task.related.label}`}>
            <Timeline entityType={task.related.type} entityId={task.related.id} refreshKey={timelineKey} />
          </Card>
        )}
      </div>
    </div>
  );
}
