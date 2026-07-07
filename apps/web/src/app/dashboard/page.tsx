'use client';

import { useAuth } from '@clerk/nextjs';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { MeResponse } from '@crm/types';
import { fetchMe } from '@/lib/api';
import { Button } from '@/components/crm/ui';
import { EmptyState } from '@/components/crm/EmptyState';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; me: MeResponse };

/** The four job-to-be-done entry points. */
const JOBS: Array<{ label: string; description: string; href: string; icon: string }> = [
  { label: 'Understand', description: 'Sales dashboard, funnel & trends', href: '/dashboard/sales', icon: '📊' },
  { label: 'Act', description: 'Contacts, deals, tasks & calendar', href: '/dashboard/contacts', icon: '⚡' },
  { label: 'Support', description: 'Calls & notifications', href: '/dashboard/calls', icon: '📞' },
  { label: 'Configure', description: 'Custom fields, pipelines, integrations', href: '/dashboard/settings/integrations', icon: '⚙️' },
];

export default function DashboardPage() {
  const { getToken, isLoaded } = useAuth();
  const [state, setState] = useState<State>({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      setState({ status: 'ready', me: await fetchMe(getToken) });
    } catch (err) {
      setState({ status: 'error', message: (err as Error).message });
    }
  }, [getToken]);

  useEffect(() => {
    if (isLoaded) void load();
  }, [isLoaded, load]);

  const greeting =
    state.status === 'ready'
      ? [state.me.user.firstName, state.me.user.lastName].filter(Boolean).join(' ') || state.me.user.email
      : '…';
  const orgName = state.status === 'ready' ? state.me.organization.name : '';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">
          Welcome{state.status === 'ready' ? `, ${greeting}` : ''}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {orgName ? `${orgName} · ` : ''}Pick a job to get started.
        </p>
      </div>

      {state.status === 'error' && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <p className="font-medium">Could not load your profile.</p>
          <p className="mt-1 break-words">{state.message}</p>
          <button onClick={() => void load()} className="mt-3 rounded-md bg-red-600 px-3 py-1.5 text-white">
            Retry
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {JOBS.map((job) => (
          <Link
            key={job.label}
            href={job.href}
            className="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-brand-400 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-600"
          >
            <div className="text-2xl">{job.icon}</div>
            <div className="mt-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {job.label}
            </div>
            <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{job.description}</p>
          </Link>
        ))}
      </div>

      <EmptyState
        icon="👋"
        title="Welcome to your CRM"
        description="Your workspace is set up. Jump into Contacts to start acting on your pipeline, or open the Sales dashboard to understand where things stand."
        action={
          <div className="flex justify-center gap-2">
            <Link href="/dashboard/contacts">
              <Button>Go to Contacts</Button>
            </Link>
            <Link href="/dashboard/sales">
              <Button variant="secondary">View Dashboard</Button>
            </Link>
          </div>
        }
      />
    </div>
  );
}
