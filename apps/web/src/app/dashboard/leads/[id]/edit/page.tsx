'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { LEAD_STATUSES, type Lead, type LeadStatus, type UpdateLeadInput } from '@crm/types';
import { useAuth } from '@clerk/nextjs';
import { getLead, updateLead } from '@/lib/api';
import { EntityForm, type FormFieldDef } from '@/components/crm/EntityForm';
import { Card, ErrorPanel, PageHeader, Spinner } from '@/components/crm/ui';

const CREATE_STATUSES = LEAD_STATUSES.filter((s) => s !== 'CONVERTED');

export default function EditLeadPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { getToken } = useAuth();
  const [lead, setLead] = useState<Lead | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) throw new Error('No session token available');
      setLead(await getLead(token, id));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [getToken, id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorPanel message={error} onRetry={() => void load()} />;
  if (!lead) return <Spinner />;
  const converted = lead.status === 'CONVERTED';

  const fields: FormFieldDef[] = [
    { name: 'firstName', label: 'First name', required: true },
    { name: 'lastName', label: 'Last name', required: true },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'phone', label: 'Phone', type: 'tel' },
    { name: 'source', label: 'Source' },
    // A converted lead's status is locked.
    ...(converted
      ? []
      : ([{ name: 'status', label: 'Status', type: 'select', options: CREATE_STATUSES.map((s) => ({ label: s, value: s })) }] as FormFieldDef[])),
  ];

  return (
    <div className="space-y-4">
      <PageHeader title={`Edit ${lead.firstName} ${lead.lastName}`} />
      <Card>
        <EntityForm
          entityType="LEAD"
          fields={fields}
          initial={{
            core: {
              firstName: lead.firstName,
              lastName: lead.lastName,
              email: lead.email ?? '',
              phone: lead.phone ?? '',
              source: lead.source ?? '',
              status: lead.status,
            },
            customFields: lead.customFields,
            tagIds: lead.tags.map((t) => t.id),
          }}
          submitLabel="Save changes"
          onCancel={() => router.push(`/dashboard/leads/${id}`)}
          onSubmit={async ({ core, customFields, tagIds }) => {
            const token = await getToken();
            if (!token) throw new Error('No session token available');
            const body: UpdateLeadInput = {
              firstName: core.firstName,
              lastName: core.lastName,
              email: core.email || undefined,
              phone: core.phone || undefined,
              source: core.source || undefined,
              ...(converted ? {} : { status: core.status as LeadStatus }),
              customFields,
              tagIds,
            };
            await updateLead(token, id, body);
            router.push(`/dashboard/leads/${id}`);
          }}
        />
      </Card>
    </div>
  );
}
