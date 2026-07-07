'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import type { Contact } from '@crm/types';
import { deleteContact, getContact } from '@/lib/api';
import { Button, Card, ErrorPanel, PageHeader, Row, Spinner } from '@/components/crm/ui';
import { CustomFieldView } from '@/components/crm/CustomFieldView';
import { TagList } from '@/components/crm/TagPicker';
import { NoteList } from '@/components/crm/NoteList';
import { Timeline } from '@/components/crm/Timeline';
import { DealsSection } from '@/components/crm/DealsSection';
import { TasksSection } from '@/components/crm/TasksSection';

export default function ContactDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { getToken } = useAuth();
  const [state, setState] = useState<{ status: 'loading' | 'error' | 'ready'; contact?: Contact; message?: string }>({
    status: 'loading',
  });
  const [timelineKey, setTimelineKey] = useState(0);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      setState({ status: 'ready', contact: await getContact(getToken, id) });
    } catch (err) {
      setState({ status: 'error', message: (err as Error).message });
    }
  }, [getToken, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async () => {
    if (!confirm('Delete this contact?')) return;
    await deleteContact(getToken, id);
    router.push('/dashboard/contacts');
  };

  if (state.status === 'loading') return <Spinner />;
  if (state.status === 'error') return <ErrorPanel message={state.message ?? ''} onRetry={() => void load()} />;
  const c = state.contact!;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${c.firstName} ${c.lastName}`}
        subtitle={c.jobTitle ?? undefined}
        action={
          <div className="flex gap-2">
            <Link href={`/dashboard/contacts/${id}/edit`}>
              <Button variant="secondary">Edit</Button>
            </Link>
            <Button variant="danger" onClick={() => void remove()}>
              Delete
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        {c.email && (
          <a href={`mailto:${c.email}`}>
            <Button variant="secondary">Email</Button>
          </a>
        )}
        {c.phone && (
          <a href={`tel:${c.phone}`}>
            <Button variant="secondary">Call</Button>
          </a>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Details">
          <Row label="Email" value={c.email ?? '—'} />
          <Row label="Phone" value={c.phone ?? '—'} />
          <Row
            label="Company"
            value={
              c.company ? (
                <Link href={`/dashboard/companies/${c.company.id}`} className="text-brand-600 hover:underline">
                  {c.company.name}
                </Link>
              ) : (
                '—'
              )
            }
          />
          <div className="mt-3">
            <TagList tags={c.tags} />
          </div>
        </Card>

        <Card title="Custom fields">
          <CustomFieldView entityType="CONTACT" values={c.customFields} />
        </Card>

        <DealsSection contactId={id} />

        <TasksSection relatedType="CONTACT" relatedId={id} relatedLabel={`${c.firstName} ${c.lastName}`} />

        <Card title="Notes">
          <NoteList entityType="CONTACT" entityId={id} onAdded={() => setTimelineKey((k) => k + 1)} />
        </Card>

        <Card title="Activity">
          <Timeline entityType="CONTACT" entityId={id} refreshKey={timelineKey} />
        </Card>
      </div>
    </div>
  );
}
