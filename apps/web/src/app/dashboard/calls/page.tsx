'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import type { Call, OrgUser } from '@crm/types';
import { listCalls, listUsers, type CallListParams, type ListParams, type TokenGetter } from '@/lib/api';
import { DataTable, type Column } from '@/components/crm/DataTable';
import { PageHeader, dateOnly, actorName, formatDate } from '@/components/crm/ui';
import { CallStatusBadge, ConsentBadge, DirectionIcon, formatCallDuration } from '@/components/crm/callUi';

export default function CallHistoryPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [direction, setDirection] = useState('');
  const [status, setStatus] = useState('');
  const [agent, setAgent] = useState('');
  const [users, setUsers] = useState<OrgUser[]>([]);

  useEffect(() => {
    void listUsers(getToken)
      .then((r) => setUsers(r.data))
      .catch(() => setUsers([]));
  }, [getToken]);

  const columns: Column<Call>[] = [
    { key: 'dir', header: '', render: (c) => <DirectionIcon direction={c.direction} /> },
    {
      key: 'who',
      header: 'Contact / Number',
      render: (c) =>
        c.contact ? (
          <span className="font-medium text-slate-800">
            {c.contact.firstName} {c.contact.lastName}
            {c.ambiguousMatch && <span title="Number matched multiple contacts"> ⚠️</span>}
          </span>
        ) : (
          <span className="text-slate-500">{c.direction === 'INBOUND' ? c.fromNumber : c.toNumber}</span>
        ),
    },
    { key: 'agent', header: 'Agent', render: (c) => actorName(c.agent) },
    { key: 'started', header: 'When', render: (c) => (c.startedAt ? formatDate(c.startedAt) : dateOnly(c.createdAt)) },
    { key: 'duration', header: 'Duration', render: (c) => formatCallDuration(c.durationSeconds) },
    { key: 'status', header: 'Status', render: (c) => <CallStatusBadge status={c.status} /> },
    { key: 'disposition', header: 'Disposition', render: (c) => c.disposition ?? '—' },
    {
      key: 'consent',
      header: 'Consent',
      render: (c) => (c.contactId ? <ConsentBadge status={c.consentStatus} /> : '—'),
    },
    { key: 'rec', header: 'Rec', render: (c) => (c.recordingAvailable ? <span title="Recording available">▶</span> : '—') },
  ];

  const reloadKey = `${direction}|${status}|${agent}`;
  const fetchPage = useMemo(
    () => (token: TokenGetter, params: ListParams) => {
      const p: CallListParams = {
        ...params,
        direction: (direction || undefined) as CallListParams['direction'],
        status: (status || undefined) as CallListParams['status'],
        agentUserId: agent || undefined,
      };
      return listCalls(token, p);
    },
    [direction, status, agent],
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Call history" subtitle="Inbound & outbound calls logged via MyOperator" />
      <DataTable
        columns={columns}
        fetchPage={fetchPage}
        reloadKey={reloadKey}
        onRowClick={(c) => router.push(`/dashboard/calls/${c.id}`)}
        searchPlaceholder="Search number / disposition…"
        emptyLabel="No calls yet."
        filters={[
          {
            label: 'Direction',
            value: direction,
            onChange: setDirection,
            options: [
              { label: 'Inbound', value: 'INBOUND' },
              { label: 'Outbound', value: 'OUTBOUND' },
            ],
          },
          {
            label: 'Status',
            value: status,
            onChange: setStatus,
            options: [
              { label: 'Completed', value: 'COMPLETED' },
              { label: 'Missed', value: 'MISSED' },
              { label: 'No answer', value: 'NO_ANSWER' },
              { label: 'Failed', value: 'FAILED' },
            ],
          },
          {
            label: 'Agent',
            value: agent,
            onChange: setAgent,
            options: [
              { label: 'Me', value: 'me' },
              ...users.map((u) => ({ label: actorName(u), value: u.id })),
            ],
          },
        ]}
      />
    </div>
  );
}
