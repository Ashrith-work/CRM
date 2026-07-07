'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import type { CreateTaskInput, OrgUser, RelatedType, Task, TaskType } from '@crm/types';
import { listCompanies, listContacts, listDeals, listLeads, listUsers } from '@/lib/api';
import { Button, ErrorPanel, actorName } from './ui';
import { TASK_TYPE_LABEL } from './taskUi';

/** Common reminder offsets offered as checkboxes (minutes before the anchor). */
const OFFSETS: Array<{ minutes: number; label: string }> = [
  { minutes: 0, label: 'At time' },
  { minutes: 15, label: '15 min before' },
  { minutes: 60, label: '1 hour before' },
  { minutes: 1440, label: '1 day before' },
];

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500';

/** ISO instant → value for <input type="datetime-local"> (local wall-clock). */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** datetime-local value → absolute UTC ISO string (offset preserved via Date). */
function localInputToIso(local: string): string | undefined {
  return local ? new Date(local).toISOString() : undefined;
}

interface RelatedOption {
  type: RelatedType;
  id: string;
  label: string;
}

export interface TaskFormValue extends CreateTaskInput {}

export function TaskForm({
  initial,
  prefill,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Task;
  prefill?: { type?: TaskType; relatedType?: RelatedType; relatedId?: string; relatedLabel?: string };
  submitLabel: string;
  onSubmit: (value: CreateTaskInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const { getToken } = useAuth();

  const [type, setType] = useState<TaskType>(initial?.type ?? prefill?.type ?? 'TASK');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [priority, setPriority] = useState(initial?.priority ?? 'MEDIUM');
  const [assigneeId, setAssigneeId] = useState(initial?.assigneeId ?? '');
  const [dueAt, setDueAt] = useState(isoToLocalInput(initial?.dueAt ?? null));
  const [startAt, setStartAt] = useState(isoToLocalInput(initial?.startAt ?? null));
  const [endAt, setEndAt] = useState(isoToLocalInput(initial?.endAt ?? null));
  const [location, setLocation] = useState(initial?.location ?? '');
  const [meetingUrl, setMeetingUrl] = useState(initial?.meetingUrl ?? '');
  const [relatedType, setRelatedType] = useState<RelatedType | ''>(
    initial?.relatedType ?? prefill?.relatedType ?? '',
  );
  const [relatedId, setRelatedId] = useState(initial?.relatedId ?? prefill?.relatedId ?? '');

  const [users, setUsers] = useState<OrgUser[]>([]);
  const [relatedOptions, setRelatedOptions] = useState<RelatedOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Preselect reminder offsets. For edit, derive from existing SCHEDULED reminders.
  const initialOffsets = useMemo(() => {
    if (!initial) return new Set<number>([15]);
    const anchorIso = initial.startAt ?? initial.dueAt;
    if (!anchorIso) return new Set<number>();
    const anchor = new Date(anchorIso).getTime();
    const chosen = new Set<number>();
    for (const r of initial.reminders) {
      if (r.status !== 'SCHEDULED') continue;
      const minutes = Math.round((anchor - new Date(r.remindAt).getTime()) / 60_000);
      if (OFFSETS.some((o) => o.minutes === minutes)) chosen.add(minutes);
    }
    return chosen;
  }, [initial]);
  const [offsets, setOffsets] = useState<Set<number>>(initialOffsets);

  useEffect(() => {
    void (async () => {
      const token = await getToken();
      if (!token) return;
      try {
        setUsers((await listUsers(token)).data);
      } catch {
        /* best-effort */
      }
    })();
  }, [getToken]);

  // Load candidate related records for the chosen type (skipped when prefilled).
  const loadRelated = useCallback(async () => {
    if (!relatedType || (prefill?.relatedId && relatedType === prefill.relatedType)) {
      setRelatedOptions([]);
      return;
    }
    const token = await getToken();
    if (!token) return;
    const opts: RelatedOption[] = [];
    if (relatedType === 'CONTACT') {
      (await listContacts(token, { limit: 100 })).data.forEach((c) =>
        opts.push({ type: 'CONTACT', id: c.id, label: `${c.firstName} ${c.lastName}` }),
      );
    } else if (relatedType === 'COMPANY') {
      (await listCompanies(token, { limit: 100 })).data.forEach((c) => opts.push({ type: 'COMPANY', id: c.id, label: c.name }));
    } else if (relatedType === 'LEAD') {
      (await listLeads(token, { limit: 100 })).data.forEach((l) =>
        opts.push({ type: 'LEAD', id: l.id, label: `${l.firstName} ${l.lastName}` }),
      );
    } else if (relatedType === 'DEAL') {
      (await listDeals(token, { limit: 100 })).data.forEach((d) => opts.push({ type: 'DEAL', id: d.id, label: d.name }));
    }
    setRelatedOptions(opts);
  }, [getToken, relatedType, prefill?.relatedId, prefill?.relatedType]);

  useEffect(() => {
    void loadRelated();
  }, [loadRelated]);

  const toggleOffset = (m: number) =>
    setOffsets((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const isMeeting = type === 'MEETING';
      const body: CreateTaskInput = {
        type,
        title,
        description: description || undefined,
        priority,
        dueAt: isMeeting ? undefined : localInputToIso(dueAt),
        startAt: isMeeting ? localInputToIso(startAt) : undefined,
        endAt: isMeeting ? localInputToIso(endAt) : undefined,
        location: isMeeting ? location || undefined : undefined,
        meetingUrl: isMeeting ? meetingUrl || undefined : undefined,
        assigneeId: assigneeId || undefined,
        relatedType: relatedType || undefined,
        relatedId: relatedType ? relatedId || undefined : undefined,
        reminders: [...offsets].sort((a, b) => a - b).map((minutesBefore) => ({ minutesBefore })),
      };
      await onSubmit(body);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const prefilledRelated = prefill?.relatedId && relatedType === prefill.relatedType;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-5"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Type</span>
          <select value={type} onChange={(e) => setType(e.target.value as TaskType)} className={inputClass}>
            {(['TASK', 'FOLLOW_UP', 'MEETING', 'CALL'] as TaskType[]).map((t) => (
              <option key={t} value={t}>
                {TASK_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Priority</span>
          <select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} className={inputClass}>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
          </select>
        </label>
        <label className="col-span-full block text-sm">
          <span className="mb-1 block font-medium text-slate-700">
            Title<span className="text-red-500"> *</span>
          </span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </label>
        <label className="col-span-full block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Description</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={inputClass} />
        </label>

        {type === 'MEETING' ? (
          <>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Starts</span>
              <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} className={inputClass} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Ends</span>
              <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} className={inputClass} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Location</span>
              <input value={location} onChange={(e) => setLocation(e.target.value)} className={inputClass} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Meeting URL</span>
              <input value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)} className={inputClass} />
            </label>
          </>
        ) : (
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Due</span>
            <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className={inputClass} />
          </label>
        )}

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Assignee</span>
          <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={inputClass}>
            <option value="">— Me (default) —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {actorName(u)}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Related to</span>
          <select
            value={relatedType}
            onChange={(e) => {
              setRelatedType(e.target.value as RelatedType | '');
              setRelatedId('');
            }}
            disabled={!!prefilledRelated}
            className={inputClass}
          >
            <option value="">— None —</option>
            <option value="CONTACT">Contact</option>
            <option value="COMPANY">Company</option>
            <option value="LEAD">Lead</option>
            <option value="DEAL">Deal</option>
          </select>
        </label>

        {relatedType && (
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Record</span>
            {prefilledRelated ? (
              <input value={prefill?.relatedLabel ?? relatedId} disabled className={inputClass} />
            ) : (
              <select value={relatedId} onChange={(e) => setRelatedId(e.target.value)} className={inputClass}>
                <option value="">— Select —</option>
                {relatedOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </label>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Reminders</h3>
        <div className="flex flex-wrap gap-3">
          {OFFSETS.map((o) => (
            <label key={o.minutes} className="flex items-center gap-1.5 text-sm text-slate-700">
              <input type="checkbox" checked={offsets.has(o.minutes)} onChange={() => toggleOffset(o.minutes)} />
              {o.label}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-400">Reminders fire in-app, by email, and via push on mobile.</p>
      </div>

      {error && <ErrorPanel message={error} />}

      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
