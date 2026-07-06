'use client';

import { useRouter } from 'next/navigation';
import { LEAD_STATUSES, type CreateLeadInput, type LeadStatus } from '@crm/types';
import { useAuth } from '@clerk/nextjs';
import { createLead } from '@/lib/api';
import { EntityForm, type FormFieldDef } from '@/components/crm/EntityForm';
import { Card, PageHeader } from '@/components/crm/ui';

// CONVERTED is reached only via the convert flow, so it is not a creatable status.
const CREATE_STATUSES = LEAD_STATUSES.filter((s) => s !== 'CONVERTED');

const fields: FormFieldDef[] = [
  { name: 'firstName', label: 'First name', required: true },
  { name: 'lastName', label: 'Last name', required: true },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'phone', label: 'Phone', type: 'tel' },
  { name: 'source', label: 'Source', placeholder: 'Website, Referral…' },
  { name: 'status', label: 'Status', type: 'select', options: CREATE_STATUSES.map((s) => ({ label: s, value: s })) },
];

export default function NewLeadPage() {
  const router = useRouter();
  const { getToken } = useAuth();

  return (
    <div className="space-y-4">
      <PageHeader title="New lead" />
      <Card>
        <EntityForm
          entityType="LEAD"
          fields={fields}
          initial={{ core: { status: 'NEW' } }}
          submitLabel="Create lead"
          onCancel={() => router.push('/dashboard/leads')}
          onSubmit={async ({ core, customFields, tagIds }) => {
            const token = await getToken();
            if (!token) throw new Error('No session token available');
            const body: CreateLeadInput = {
              firstName: core.firstName ?? '',
              lastName: core.lastName ?? '',
              email: core.email || undefined,
              phone: core.phone || undefined,
              source: core.source || undefined,
              status: (core.status as LeadStatus) || 'NEW',
              customFields,
              tagIds,
            };
            const created = await createLead(token, body);
            router.push(`/dashboard/leads/${created.id}`);
          }}
        />
      </Card>
    </div>
  );
}
