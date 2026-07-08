'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import type { Company, Contact } from '@crm/types';
import { deleteCompany, getCompany, listContacts } from '@/lib/api';
import { Button, Card, ErrorPanel, PageHeader, Row, Spinner } from '@/components/crm/ui';
import { CustomFieldView } from '@/components/crm/CustomFieldView';
import { TagList } from '@/components/crm/TagPicker';
import { NoteList } from '@/components/crm/NoteList';
import { Timeline } from '@/components/crm/Timeline';
import { DealsSection } from '@/components/crm/DealsSection';

export default function CompanyDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { getToken } = useAuth();
  const [company, setCompany] = useState<Company | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [error, setError] = useState('');
  const [timelineKey, setTimelineKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const [co, cs] = await Promise.all([getCompany(getToken, id), listContacts(getToken, { companyId: id, limit: 100 })]);
      setCompany(co);
      setContacts(cs.data);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [getToken, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async () => {
    if (!confirm('Delete this company? Its contacts will be detached, not deleted.')) return;
    await deleteCompany(getToken, id);
    router.push('/dashboard/companies');
  };

  if (error) return <ErrorPanel message={error} onRetry={() => void load()} />;
  if (!company) return <Spinner />;

  return (
    <div className="space-y-4">
      <PageHeader
        title={company.name}
        subtitle={company.domain ?? undefined}
        action={
          <div className="flex gap-2">
            <Link href={`/dashboard/companies/${id}/edit`}>
              <Button variant="secondary">Edit</Button>
            </Link>
            <Button variant="danger" onClick={() => void remove()}>
              Delete
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Details">
          <Row label="Industry" value={company.industry ?? '—'} />
          <Row label="Size" value={company.size ?? '—'} />
          <Row label="Website" value={company.website ?? '—'} />
          <Row label="Phone" value={company.phone ?? '—'} />
          <div className="mt-3">
            <TagList tags={company.tags} />
          </div>
        </Card>

        <Card title="Custom fields">
          <CustomFieldView entityType="COMPANY" values={company.customFields} />
        </Card>

        <Card title={`Contacts (${contacts.length})`}>
          {contacts.length === 0 ? (
            <p className="text-sm text-slate-400">No contacts at this company.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {contacts.map((c) => (
                <li key={c.id} className="py-2">
                  <Link href={`/dashboard/contacts/${c.id}`} className="text-sm text-brand-600 hover:underline">
                    {c.firstName} {c.lastName}
                  </Link>
                  {c.jobTitle && <span className="text-xs text-slate-400"> · {c.jobTitle}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <DealsSection companyId={id} />

        <Card title="Notes">
          <NoteList entityType="COMPANY" entityId={id} onAdded={() => setTimelineKey((k) => k + 1)} />
        </Card>

        <Card title="Activity">
          <Timeline entityType="COMPANY" entityId={id} refreshKey={timelineKey} />
        </Card>
      </div>
    </div>
  );
}
