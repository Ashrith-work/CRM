'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import type { Company, CreateContactInput } from '@crm/types';
import { createContact, listCompanies } from '@/lib/api';
import { EntityForm, type FormFieldDef } from '@/components/crm/EntityForm';
import { Card, PageHeader } from '@/components/crm/ui';

export default function NewContactPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);

  useEffect(() => {
    void (async () => {
      if (getToken) setCompanies((await listCompanies(getToken, { limit: 100 })).data);
    })();
  }, [getToken]);

  const fields: FormFieldDef[] = [
    { name: 'firstName', label: 'First name', required: true },
    { name: 'lastName', label: 'Last name', required: true },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'phone', label: 'Phone', type: 'tel' },
    { name: 'jobTitle', label: 'Job title' },
    {
      name: 'companyId',
      label: 'Company',
      type: 'select',
      options: [{ label: '— None —', value: '' }, ...companies.map((c) => ({ label: c.name, value: c.id }))],
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="New contact" />
      <Card>
        <EntityForm
          entityType="CONTACT"
          fields={fields}
          submitLabel="Create contact"
          onCancel={() => router.push('/dashboard/contacts')}
          onSubmit={async ({ core, customFields, tagIds }) => {
            const body: CreateContactInput = {
              firstName: core.firstName ?? '',
              lastName: core.lastName ?? '',
              email: core.email || undefined,
              phone: core.phone || undefined,
              jobTitle: core.jobTitle || undefined,
              companyId: core.companyId || null,
              customFields,
              tagIds,
            };
            const created = await createContact(getToken, body);
            router.push(`/dashboard/contacts/${created.id}`);
          }}
        />
      </Card>
    </div>
  );
}
