'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  RECOVERY_STATUSES,
  type CoordinationResponse,
  type OrgUser,
  type Prospect,
  type ProspectSegment,
  type RecoveryMetricsResponse,
  type RecoveryStatus,
} from '@crm/types';
import {
  assignProspects,
  fetchMe,
  getRecoveryCoordination,
  getRecoveryMetrics,
  getRecoveryProgress,
  listProspects,
  listUsers,
  logRecoveryProgress,
} from '@/lib/api';
import { Button, Card, ErrorPanel, PageHeader, Spinner, actorName, formatDate, formatMoney } from '@/components/crm/ui';

type Tab = 'prospects' | 'mine' | 'coordination' | 'metrics';
type CoordRow = CoordinationResponse['data'][number];

const STATUS_LABEL: Record<RecoveryStatus, string> = {
  to_contact: 'To contact',
  contacted: 'Contacted',
  interested: 'Interested',
  no_response: 'No response',
  converted: 'Converted',
  lost: 'Lost',
};

export default function RecoveryPage() {
  const { getToken } = useAuth();
  const [tab, setTab] = useState<Tab>('prospects');
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [myId, setMyId] = useState<string | null>(null);

  useEffect(() => {
    void listUsers(getToken).then((r) => setUsers(r.data)).catch(() => setUsers([]));
    void fetchMe(getToken).then((m) => setMyId(m.user.id)).catch(() => setMyId(null));
  }, [getToken]);

  const userName = useMemo(() => {
    const m = new Map(users.map((u) => [u.id, actorName(u)]));
    return (id: string | null) => (id ? m.get(id) ?? id : '—');
  }, [users]);

  return (
    <div className="space-y-4">
      <PageHeader title="Recovery leads" subtitle="Assign cart-abandoners & identified non-buyers to your team and track follow-up" />
      <nav className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {([
          ['prospects', 'Prospects'],
          ['mine', 'My leads'],
          ['coordination', 'Coordination'],
          ['metrics', 'Conversion'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium ${tab === t ? 'border-b-2 border-brand-500 text-brand-600' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'prospects' && <ProspectsTab getToken={getToken} users={users} userName={userName} />}
      {tab === 'mine' && myId && <CoordinationTab getToken={getToken} userName={userName} users={users} lockOwner={myId} />}
      {tab === 'coordination' && <CoordinationTab getToken={getToken} userName={userName} users={users} />}
      {tab === 'metrics' && <MetricsTab getToken={getToken} userName={userName} />}
    </div>
  );
}

function StatusBadge({ status }: { status: RecoveryStatus | null }) {
  if (!status) return <span className="text-slate-400">—</span>;
  const tone: Record<RecoveryStatus, string> = {
    to_contact: 'bg-slate-100 text-slate-700',
    contacted: 'bg-blue-100 text-blue-700',
    interested: 'bg-amber-100 text-amber-800',
    no_response: 'bg-slate-100 text-slate-500',
    converted: 'bg-green-100 text-green-700',
    lost: 'bg-red-100 text-red-700',
  };
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone[status]}`}>{STATUS_LABEL[status]}</span>;
}

// ---- Prospects tab (list + bulk assign + progress) -------------------------
function ProspectsTab({ getToken, users, userName }: { getToken: ReturnType<typeof useAuth>['getToken']; users: OrgUser[]; userName: (id: string | null) => string }) {
  const [segment, setSegment] = useState<ProspectSegment>('cart_abandoner');
  const [rows, setRows] = useState<Prospect[] | null>(null);
  const [anon, setAnon] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [owner, setOwner] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setRows(null);
    setErr(null);
    setSelected(new Set());
    try {
      const res = await listProspects(getToken, segment);
      setRows(res.data);
      setAnon(res.anonymousCount);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [getToken, segment]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const assign = async (toUserId: string | null) => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      await assignProspects(getToken, { customerIds: [...selected], toUserId });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-slate-200 dark:border-slate-800">
          {(['cart_abandoner', 'non_buyer'] as ProspectSegment[]).map((s) => (
            <button key={s} onClick={() => setSegment(s)} className={`px-3 py-1.5 text-sm ${segment === s ? 'bg-brand-500 text-white' : 'text-slate-600'}`}>
              {s === 'cart_abandoner' ? 'Cart abandoners' : 'Non-buyers'}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select value={owner} onChange={(e) => setOwner(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-800 dark:bg-slate-900">
            <option value="">Assign to…</option>
            {users.map((u) => <option key={u.id} value={u.id}>{actorName(u)}</option>)}
          </select>
          <Button disabled={busy || selected.size === 0 || !owner} onClick={() => assign(owner)}>Assign {selected.size || ''}</Button>
          <Button variant="secondary" disabled={busy || selected.size === 0} onClick={() => assign(null)}>Unassign</Button>
        </div>
      </div>

      {anon > 0 && (
        <p className="text-xs text-slate-500">
          + {anon.toLocaleString()} anonymous {segment === 'cart_abandoner' ? 'abandoned carts' : 'sessions'} with no identity — counted only, can’t be assigned.
        </p>
      )}
      {err && <ErrorPanel message={err} />}
      {!rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Card><p className="p-4 text-sm text-slate-500">No prospects in this segment.</p></Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="p-2"></th>
                  <th className="p-2">Prospect</th>
                  <th className="p-2">Email</th>
                  <th className="p-2">{segment === 'cart_abandoner' ? 'In cart' : 'Contact'}</th>
                  <th className="p-2 text-right">At risk</th>
                  <th className="p-2 text-right">Days</th>
                  <th className="p-2">Owner</th>
                  <th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <Fragment key={p.customerId}>
                    <tr className="border-t border-slate-100 dark:border-slate-800">
                      <td className="p-2"><input type="checkbox" checked={selected.has(p.customerId)} onChange={() => toggle(p.customerId)} /></td>
                      <td className="p-2 font-medium">
                        <button className="hover:underline" onClick={() => setExpanded(expanded === p.customerId ? null : p.customerId)}>{p.displayName}</button>
                      </td>
                      <td className="p-2 text-slate-500">{p.email ?? '—'}</td>
                      <td className="p-2 text-slate-600">{p.cartSummary ?? p.phone ?? '—'}</td>
                      <td className="p-2 text-right">{p.valueAtRiskMinor ? formatMoney(p.valueAtRiskMinor, 'INR') : '—'}</td>
                      <td className="p-2 text-right">{p.daysSince ?? '—'}</td>
                      <td className="p-2">{userName(p.ownerUserId)}</td>
                      <td className="p-2"><StatusBadge status={p.status} /></td>
                    </tr>
                    {expanded === p.customerId && (
                      <tr><td colSpan={8} className="bg-slate-50 p-3 dark:bg-slate-900/40"><ProgressPanel getToken={getToken} customerId={p.customerId} userName={userName} onSaved={load} /></td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ---- Progress panel (history + log form) -----------------------------------
function ProgressPanel({ getToken, customerId, userName, onSaved }: { getToken: ReturnType<typeof useAuth>['getToken']; customerId: string; userName: (id: string | null) => string; onSaved: () => void }) {
  const [history, setHistory] = useState<{ id: string; authorUserId: string; status: RecoveryStatus; note: string | null; createdAt: string }[]>([]);
  const [status, setStatus] = useState<RecoveryStatus>('contacted');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void getRecoveryProgress(getToken, customerId).then((r) => setHistory(r.data)).catch(() => setHistory([]));
  }, [getToken, customerId]);
  useEffect(() => load(), [load]);

  const save = async () => {
    setBusy(true);
    try {
      await logRecoveryProgress(getToken, { customerId, status, note: note.trim() || undefined });
      setNote('');
      load();
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value as RecoveryStatus)} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-800 dark:bg-slate-900">
          {RECOVERY_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (PII auto-scrubbed)…" className="flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-800 dark:bg-slate-900" />
        <Button disabled={busy} onClick={save}>Log update</Button>
      </div>
      <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
        {history.length === 0 ? <li className="text-slate-400">No follow-up yet.</li> : history.map((h) => (
          <li key={h.id}>
            <StatusBadge status={h.status} /> <span className="text-slate-400">{formatDate(h.createdAt)} · {userName(h.authorUserId)}</span>{h.note ? ` — ${h.note}` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---- Coordination tab (office-wide / my leads) -----------------------------
function CoordinationTab({ getToken, userName, users, lockOwner }: { getToken: ReturnType<typeof useAuth>['getToken']; userName: (id: string | null) => string; users: OrgUser[]; lockOwner?: string }) {
  const [rows, setRows] = useState<CoordRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [owner, setOwner] = useState(lockOwner ?? '');
  const [status, setStatus] = useState('');

  useEffect(() => {
    setRows(null);
    setErr(null);
    getRecoveryCoordination(getToken, { ownerUserId: (lockOwner ?? owner) || undefined, status: (status || undefined) as RecoveryStatus | undefined })
      .then((r) => setRows(r.data))
      .catch((e) => setErr((e as Error).message));
  }, [getToken, owner, status, lockOwner]);

  return (
    <div className="space-y-3">
      {!lockOwner && (
        <div className="flex gap-2">
          <select value={owner} onChange={(e) => setOwner(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-800 dark:bg-slate-900">
            <option value="">All owners</option>
            {users.map((u) => <option key={u.id} value={u.id}>{actorName(u)}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-800 dark:bg-slate-900">
            <option value="">All statuses</option>
            {RECOVERY_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>
      )}
      {err && <ErrorPanel message={err} />}
      {!rows ? <Spinner /> : rows.length === 0 ? (
        <Card><p className="p-4 text-sm text-slate-500">No tracked prospects.</p></Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-400">
                <tr><th className="p-2">Prospect</th><th className="p-2">Owner</th><th className="p-2">Status</th><th className="p-2">Last update</th><th className="p-2">Last note</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.customerId} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="p-2 font-medium">{r.displayName}</td>
                    <td className="p-2">{userName(r.ownerUserId)}</td>
                    <td className="p-2"><StatusBadge status={r.status} /></td>
                    <td className="p-2 text-slate-500">{r.lastUpdateAt ? formatDate(r.lastUpdateAt) : '—'}</td>
                    <td className="p-2 text-slate-600">{r.lastNote ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ---- Metrics tab -----------------------------------------------------------
function MetricsTab({ getToken, userName }: { getToken: ReturnType<typeof useAuth>['getToken']; userName: (id: string | null) => string }) {
  const [data, setData] = useState<RecoveryMetricsResponse['data'] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    getRecoveryMetrics(getToken).then((r) => setData(r.data)).catch((e) => setErr((e as Error).message));
  }, [getToken]);

  if (err) return <ErrorPanel message={err} />;
  if (!data) return <Spinner />;
  if (data.length === 0) return <Card><p className="p-4 text-sm text-slate-500">No prospects assigned yet.</p></Card>;
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-400">
            <tr><th className="p-2">Team member</th><th className="p-2 text-right">Assigned</th><th className="p-2 text-right">Converted</th><th className="p-2 text-right">Rate</th></tr>
          </thead>
          <tbody>
            {data.map((m) => (
              <tr key={m.ownerUserId} className="border-t border-slate-100 dark:border-slate-800">
                <td className="p-2 font-medium">{userName(m.ownerUserId)}</td>
                <td className="p-2 text-right">{m.assigned}</td>
                <td className="p-2 text-right">{m.converted}</td>
                <td className="p-2 text-right">{(m.conversionRate * 100).toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
