'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import type { Contact, Tag } from '@crm/types';
import { listContacts, listTags, type ListParams, type TokenGetter } from '@/lib/api';
import { DataTable, type Column } from '@/components/crm/DataTable';
import { Button, PageHeader, TagBadge } from '@/components/crm/ui';

const columns: Column<Contact>[] = [
  { key: 'name', header: 'Name', sortField: 'lastName', render: (c) => `${c.firstName} ${c.lastName}` },
  { key: 'email', header: 'Email', render: (c) => c.email ?? '—' },
  { key: 'company', header: 'Company', render: (c) => c.company?.name ?? '—' },
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

export default function ContactsPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagId, setTagId] = useState('');

  useEffect(() => {
    void (async () => {
      if (getToken) setTags((await listTags(getToken)).data);
    })();
  }, [getToken]);

  const fetchPage = useCallback(
    (getToken: TokenGetter, params: ListParams) => listContacts(getToken, { ...params, tagId: tagId || undefined }),
    [tagId],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Contacts"
        subtitle="People in your CRM."
        action={
          <Link href="/dashboard/contacts/new">
            <Button>New contact</Button>
          </Link>
        }
      />
      <DataTable
        columns={columns}
        fetchPage={fetchPage}
        reloadKey={tagId}
        onRowClick={(c) => router.push(`/dashboard/contacts/${c.id}`)}
        searchPlaceholder="Search name or email…"
        emptyLabel="No contacts yet."
        filters={[
          {
            label: 'Tag',
            value: tagId,
            onChange: setTagId,
            options: tags.map((t) => ({ label: t.name, value: t.id })),
          },
        ]}
      />
    </div>
  );
}
