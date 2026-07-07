'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import type { Company, Contact, UpdateContactInput } from '@crm/types';
import { getContact, listCompanies, updateContact } from '@/lib/api';
import { EntityForm, type FormFieldDef } from '@/components/crm/EntityForm';
import { Card, ErrorPanel, PageHeader, Spinner } from '@/components/crm/ui';

export default function EditContactPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { getToken } = useAuth();
  const [contact, setContact] = useState<Contact | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [c, cs] = await Promise.all([getContact(getToken, id), listCompanies(getToken, { limit: 100 })]);
      setContact(c);
      setCompanies(cs.data);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [getToken, id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorPanel message={error} onRetry={() => void load()} />;
  if (!contact) return <Spinner />;

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
      <PageHeader title={`Edit ${contact.firstName} ${contact.lastName}`} />
      <Card>
        <EntityForm
          entityType="CONTACT"
          fields={fields}
          initial={{
            core: {
              firstName: contact.firstName,
              lastName: contact.lastName,
              email: contact.email ?? '',
              phone: contact.phone ?? '',
              jobTitle: contact.jobTitle ?? '',
              companyId: contact.companyId ?? '',
            },
            customFields: contact.customFields,
            tagIds: contact.tags.map((t) => t.id),
          }}
          submitLabel="Save changes"
          onCancel={() => router.push(`/dashboard/contacts/${id}`)}
          onSubmit={async ({ core, customFields, tagIds }) => {
            const body: UpdateContactInput = {
              firstName: core.firstName,
              lastName: core.lastName,
              email: core.email || undefined,
              phone: core.phone || undefined,
              jobTitle: core.jobTitle || undefined,
              companyId: core.companyId || null,
              customFields,
              tagIds,
            };
            await updateContact(getToken, id, body);
            router.push(`/dashboard/contacts/${id}`);
          }}
        />
      </Card>
    </div>
  );
}
