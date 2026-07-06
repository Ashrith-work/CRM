'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import type { CreateCompanyInput } from '@crm/types';
import { createCompany } from '@/lib/api';
import { EntityForm, type FormFieldDef } from '@/components/crm/EntityForm';
import { Card, PageHeader } from '@/components/crm/ui';

const fields: FormFieldDef[] = [
  { name: 'name', label: 'Name', required: true },
  { name: 'domain', label: 'Domain', placeholder: 'acme.com' },
  { name: 'industry', label: 'Industry' },
  { name: 'size', label: 'Size', placeholder: '51-200' },
  { name: 'website', label: 'Website' },
  { name: 'phone', label: 'Phone', type: 'tel' },
];

export default function NewCompanyPage() {
  const router = useRouter();
  const { getToken } = useAuth();

  return (
    <div className="space-y-4">
      <PageHeader title="New company" />
      <Card>
        <EntityForm
          entityType="COMPANY"
          fields={fields}
          submitLabel="Create company"
          onCancel={() => router.push('/dashboard/companies')}
          onSubmit={async ({ core, customFields, tagIds }) => {
            const token = await getToken();
            if (!token) throw new Error('No session token available');
            const body: CreateCompanyInput = {
              name: core.name ?? '',
              domain: core.domain || undefined,
              industry: core.industry || undefined,
              size: core.size || undefined,
              website: core.website || undefined,
              phone: core.phone || undefined,
              customFields,
              tagIds,
            };
            const created = await createCompany(token, body);
            router.push(`/dashboard/companies/${created.id}`);
          }}
        />
      </Card>
    </div>
  );
}
