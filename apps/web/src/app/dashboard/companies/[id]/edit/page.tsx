'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import type { Company, UpdateCompanyInput } from '@crm/types';
import { getCompany, updateCompany } from '@/lib/api';
import { EntityForm, type FormFieldDef } from '@/components/crm/EntityForm';
import { Card, ErrorPanel, PageHeader, Spinner } from '@/components/crm/ui';

const fields: FormFieldDef[] = [
  { name: 'name', label: 'Name', required: true },
  { name: 'domain', label: 'Domain' },
  { name: 'industry', label: 'Industry' },
  { name: 'size', label: 'Size' },
  { name: 'website', label: 'Website' },
  { name: 'phone', label: 'Phone', type: 'tel' },
];

export default function EditCompanyPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { getToken } = useAuth();
  const [company, setCompany] = useState<Company | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) throw new Error('No session token available');
      setCompany(await getCompany(token, id));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [getToken, id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorPanel message={error} onRetry={() => void load()} />;
  if (!company) return <Spinner />;

  return (
    <div className="space-y-4">
      <PageHeader title={`Edit ${company.name}`} />
      <Card>
        <EntityForm
          entityType="COMPANY"
          fields={fields}
          initial={{
            core: {
              name: company.name,
              domain: company.domain ?? '',
              industry: company.industry ?? '',
              size: company.size ?? '',
              website: company.website ?? '',
              phone: company.phone ?? '',
            },
            customFields: company.customFields,
            tagIds: company.tags.map((t) => t.id),
          }}
          submitLabel="Save changes"
          onCancel={() => router.push(`/dashboard/companies/${id}`)}
          onSubmit={async ({ core, customFields, tagIds }) => {
            const token = await getToken();
            if (!token) throw new Error('No session token available');
            const body: UpdateCompanyInput = {
              name: core.name,
              domain: core.domain || undefined,
              industry: core.industry || undefined,
              size: core.size || undefined,
              website: core.website || undefined,
              phone: core.phone || undefined,
              customFields,
              tagIds,
            };
            await updateCompany(token, id, body);
            router.push(`/dashboard/companies/${id}`);
          }}
        />
      </Card>
    </div>
  );
}
