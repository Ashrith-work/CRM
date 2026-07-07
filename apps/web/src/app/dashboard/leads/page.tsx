'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { LEAD_STATUSES, type Lead, type Tag } from '@crm/types';
import { useAuth } from '@clerk/nextjs';
import { listLeads, listTags, type ListParams, type TokenGetter } from '@/lib/api';
import { DataTable, type Column } from '@/components/crm/DataTable';
import { Button, PageHeader, TagBadge } from '@/components/crm/ui';

const STATUS_COLOR: Record<string, string> = {
  NEW: 'bg-slate-100 text-slate-700',
  CONTACTED: 'bg-sky-100 text-sky-700',
  QUALIFIED: 'bg-amber-100 text-amber-700',
  UNQUALIFIED: 'bg-red-100 text-red-700',
  CONVERTED: 'bg-green-100 text-green-700',
};

const columns: Column<Lead>[] = [
  { key: 'name', header: 'Name', sortField: 'lastName', render: (l) => `${l.firstName} ${l.lastName}` },
  { key: 'email', header: 'Email', render: (l) => l.email ?? '—' },
  { key: 'source', header: 'Source', render: (l) => l.source ?? '—' },
  {
    key: 'status',
    header: 'Status',
    sortField: 'status',
    render: (l) => (
      <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[l.status]}`}>{l.status}</span>
    ),
  },
  {
    key: 'tags',
    header: 'Tags',
    render: (l) => (
      <div className="flex flex-wrap gap-1">
        {l.tags.map((t) => (
          <TagBadge key={t.id} name={t.name} color={t.color} />
        ))}
      </div>
    ),
  },
];

export default function LeadsPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagId, setTagId] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    void (async () => {
      if (getToken) setTags((await listTags(getToken)).data);
    })();
  }, [getToken]);

  const fetchPage = useCallback(
    (getToken: TokenGetter, params: ListParams) =>
      listLeads(getToken, {
        ...params,
        tagId: tagId || undefined,
        status: (status || undefined) as ListParams['status'],
      }),
    [tagId, status],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Leads"
        subtitle="Prospects to qualify and convert."
        action={
          <Link href="/dashboard/leads/new">
            <Button>New lead</Button>
          </Link>
        }
      />
      <DataTable
        columns={columns}
        fetchPage={fetchPage}
        reloadKey={`${tagId}|${status}`}
        onRowClick={(l) => router.push(`/dashboard/leads/${l.id}`)}
        searchPlaceholder="Search name or email…"
        emptyLabel="No leads yet."
        filters={[
          { label: 'Status', value: status, onChange: setStatus, options: LEAD_STATUSES.map((s) => ({ label: s, value: s })) },
          { label: 'Tag', value: tagId, onChange: setTagId, options: tags.map((t) => ({ label: t.name, value: t.id })) },
        ]}
      />
    </div>
  );
}
