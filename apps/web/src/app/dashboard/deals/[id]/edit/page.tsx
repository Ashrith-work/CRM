'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import type { Company, Contact, Deal, UpdateDealInput } from '@crm/types';
import { getDeal, listCompanies, listContacts, updateDeal } from '@/lib/api';
import { EntityForm, type FormFieldDef } from '@/components/crm/EntityForm';
import { Card, PageHeader, Spinner, fromMinor, toMinor } from '@/components/crm/ui';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD'];

export default function EditDealPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { getToken } = useAuth();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    const [d, c, co] = await Promise.all([
      getDeal(token, id),
      listContacts(token, { limit: 100 }),
      listCompanies(token, { limit: 100 }),
    ]);
    setDeal(d);
    setContacts(c.data);
    setCompanies(co.data);
  }, [getToken, id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!deal) return <Spinner />;

  const fields: FormFieldDef[] = [
    { name: 'name', label: 'Deal name', required: true },
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
      <PageHeader title={`Edit ${deal.name}`} />
      <Card>
        <EntityForm
          entityType="DEAL"
          fields={fields}
          initial={{
            core: {
              name: deal.name,
              amount: fromMinor(deal.amountMinor),
              currency: deal.currency,
              expectedCloseDate: deal.expectedCloseDate ? deal.expectedCloseDate.slice(0, 10) : '',
              contactId: deal.contactId ?? '',
              companyId: deal.companyId ?? '',
            },
            customFields: deal.customFields,
            tagIds: deal.tags.map((t) => t.id),
          }}
          submitLabel="Save changes"
          onCancel={() => router.push(`/dashboard/deals/${id}`)}
          onSubmit={async ({ core, customFields, tagIds }) => {
            const token = await getToken();
            if (!token) throw new Error('No session token available');
            const body: UpdateDealInput = {
              name: core.name,
              amountMinor: core.amount !== undefined ? toMinor(core.amount) : undefined,
              currency: core.currency || undefined,
              expectedCloseDate: core.expectedCloseDate ? core.expectedCloseDate : null,
              contactId: core.contactId || null,
              companyId: core.companyId || null,
              customFields,
              tagIds,
            };
            await updateDeal(token, id, body);
            router.push(`/dashboard/deals/${id}`);
          }}
        />
      </Card>
    </div>
  );
}
