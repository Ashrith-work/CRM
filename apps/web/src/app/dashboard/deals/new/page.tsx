'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import type { Company, Contact, CreateDealInput, Pipeline } from '@crm/types';
import { createDeal, listCompanies, listContacts, listPipelines } from '@/lib/api';
import { EntityForm, type FormFieldDef } from '@/components/crm/EntityForm';
import { Card, PageHeader, Spinner, toMinor } from '@/components/crm/ui';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD'];

function NewDealForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { getToken } = useAuth();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      const [p, c, co] = await Promise.all([
        listPipelines(getToken),
        listContacts(getToken, { limit: 100 }),
        listCompanies(getToken, { limit: 100 }),
      ]);
      setPipelines(p.data);
      setContacts(c.data);
      setCompanies(co.data);
      setReady(true);
    })();
  }, [getToken]);

  if (!ready) return <Spinner />;

  const prefillContact = searchParams.get('contactId') ?? '';
  const prefillCompany = searchParams.get('companyId') ?? '';
  const defaultPipeline = pipelines.find((p) => p.isDefault)?.id ?? pipelines[0]?.id ?? '';

  const fields: FormFieldDef[] = [
    { name: 'name', label: 'Deal name', required: true },
    {
      name: 'pipelineId',
      label: 'Pipeline',
      type: 'select',
      required: true,
      options: pipelines.map((p) => ({ label: p.name, value: p.id })),
    },
    { name: 'amount', label: 'Amount', type: 'number', placeholder: '0.00' },
    { name: 'currency', label: 'Currency', type: 'select', options: CURRENCIES.map((c) => ({ label: c, value: c })) },
    { name: 'expectedCloseDate', label: 'Expected close', type: 'date' },
    {
      name: 'contactId',
      label: 'Contact',
      type: 'select',
      options: [{ label: '— None —', value: '' }, ...contacts.map((c) => ({ label: `${c.firstName} ${c.lastName}`, value: c.id }))],
    },
    {
      name: 'companyId',
      label: 'Company',
      type: 'select',
      options: [{ label: '— None —', value: '' }, ...companies.map((c) => ({ label: c.name, value: c.id }))],
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="New deal" />
      <Card>
        <EntityForm
          entityType="DEAL"
          fields={fields}
          initial={{ core: { pipelineId: defaultPipeline, currency: 'USD', contactId: prefillContact, companyId: prefillCompany } }}
          submitLabel="Create deal"
          onCancel={() => router.push('/dashboard/deals')}
          onSubmit={async ({ core, customFields, tagIds }) => {
            const body: CreateDealInput = {
              name: core.name ?? '',
              pipelineId: core.pipelineId ?? defaultPipeline,
              amountMinor: core.amount ? toMinor(core.amount) : 0,
              currency: core.currency || 'USD',
              expectedCloseDate: core.expectedCloseDate || undefined,
              contactId: core.contactId || null,
              companyId: core.companyId || null,
              customFields,
              tagIds,
            };
            const created = await createDeal(getToken, body);
            router.push(`/dashboard/deals/${created.id}`);
          }}
        />
      </Card>
    </div>
  );
}

export default function NewDealPage() {
  // useSearchParams() must sit inside a Suspense boundary or Next's static
  // prerender bails out ("missing-suspense-with-csr-bailout").
  return (
    <Suspense fallback={<Spinner />}>
      <NewDealForm />
    </Suspense>
  );
}
