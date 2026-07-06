'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import type { Company, Tag } from '@crm/types';
import { listCompanies, listTags, type ListParams } from '@/lib/api';
import { DataTable, type Column } from '@/components/crm/DataTable';
import { Button, PageHeader, TagBadge } from '@/components/crm/ui';

const columns: Column<Company>[] = [
  { key: 'name', header: 'Name', sortField: 'name', render: (c) => c.name },
  { key: 'domain', header: 'Domain', render: (c) => c.domain ?? '—' },
  { key: 'industry', header: 'Industry', render: (c) => c.industry ?? '—' },
  {
    key: 'tags',
    header: 'Tags',
    render: (c) => (
      <div className="flex flex-wrap gap-1">
        {c.tags.map((t) => (
          <TagBadge key={t.id} name={t.name} color={t.color} />
        ))}
      </div>
    ),
  },
];

export default function CompaniesPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagId, setTagId] = useState('');

  useEffect(() => {
    void (async () => {
      const token = await getToken();
      if (token) setTags((await listTags(token)).data);
    })();
  }, [getToken]);

  const fetchPage = useCallback(
    (token: string, params: ListParams) => listCompanies(token, { ...params, tagId: tagId || undefined }),
    [tagId],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Companies"
        subtitle="Organizations in your CRM."
        action={
          <Link href="/dashboard/companies/new">
            <Button>New company</Button>
          </Link>
        }
      />
      <DataTable
        columns={columns}
        fetchPage={fetchPage}
        reloadKey={tagId}
        onRowClick={(c) => router.push(`/dashboard/companies/${c.id}`)}
        searchPlaceholder="Search name or domain…"
        emptyLabel="No companies yet."
        filters={[
          { label: 'Tag', value: tagId, onChange: setTagId, options: tags.map((t) => ({ label: t.name, value: t.id })) },
        ]}
      />
    </div>
  );
}
