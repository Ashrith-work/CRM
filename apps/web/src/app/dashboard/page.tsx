'use client';

import { useAuth } from '@clerk/nextjs';
import { useCallback, useEffect, useState } from 'react';
import type { MeResponse } from '@crm/types';
import { fetchMe } from '@/lib/api';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; me: MeResponse };

export default function DashboardPage() {
  const { getToken, isLoaded } = useAuth();
  const [state, setState] = useState<State>({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const token = await getToken();
      if (!token) throw new Error('No session token available');
      const me = await fetchMe(token);
      setState({ status: 'ready', me });
    } catch (err) {
      setState({ status: 'error', message: (err as Error).message });
    }
  }, [getToken]);

  useEffect(() => {
    if (isLoaded) void load();
  }, [isLoaded, load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-slate-500">Data below comes from GET /api/v1/me.</p>
      </div>

      {state.status === 'loading' && <p className="text-slate-500">Loading…</p>}

      {state.status === 'error' && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-medium">Could not load your profile.</p>
          <p className="mt-1 break-words">{state.message}</p>
          <button
            onClick={() => void load()}
            className="mt-3 rounded-md bg-red-600 px-3 py-1.5 text-white"
          >
            Retry
          </button>
        </div>
      )}

      {state.status === 'ready' && <MeCard me={state.me} />}
    </div>
  );
}

function MeCard({ me }: { me: MeResponse }) {
  const name = [me.user.firstName, me.user.lastName].filter(Boolean).join(' ') || '—';
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Card title="User">
        <Row label="Name" value={name} />
        <Row label="Email" value={me.user.email} />
      </Card>
      <Card title="Organization">
        <Row label="Name" value={me.organization.name} />
        <Row label="Slug" value={me.organization.slug} />
      </Card>
      <Card title="Team">
        <Row label="Name" value={me.team?.name ?? 'No team'} />
      </Card>
      <Card title="Role">
        <Row label="Role" value={me.role.name} />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {me.role.permissions.map((p) => (
            <span
              key={p}
              className="rounded bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700"
            >
              {p}
            </span>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-0.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
