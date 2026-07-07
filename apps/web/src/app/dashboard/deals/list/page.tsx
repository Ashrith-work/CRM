'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Deal } from '@crm/types';
import { listDeals, type DealListParams, type ListParams, type TokenGetter } from '@/lib/api';
import { DataTable, type Column } from '@/components/crm/DataTable';
import { Button, PageHeader, formatMoney, dateOnly } from '@/components/crm/ui';

const STATUS_BADGE: Record<string, string> = {
  OPEN: 'bg-brand-50 text-brand-700',
  WON: 'bg-green-50 text-green-700',
  LOST: 'bg-red-50 text-red-700',
};

export default function DealsListPage() {
  const router = useRouter();
  const [status, setStatus] = useState('');

  const columns: Column<Deal>[] = [
    { key: 'name', header: 'Deal', sortField: 'name', render: (d) => <span className="font-medium text-slate-800">{d.name}</span> },
    { key: 'amount', header: 'Amount', sortField: 'amountMinor', render: (d) => formatMoney(d.amountMinor, d.currency) },
    {
      key: 'status',
      header: 'Status',
      render: (d) => <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[d.status]}`}>{d.status}</span>,
    },
    { key: 'contact', header: 'Contact', render: (d) => (d.contact ? `${d.contact.firstName} ${d.contact.lastName}` : '—') },
    { key: 'company', header: 'Company', render: (d) => d.company?.name ?? '—' },
    { key: 'close', header: 'Close date', sortField: 'expectedCloseDate', render: (d) => dateOnly(d.expectedCloseDate) },
  ];

  const fetchPage = useMemo(
    () => (getToken: TokenGetter, params: ListParams) => {
      const p: DealListParams = { ...params, status: (status || undefined) as DealListParams['status'] };
      return listDeals(getToken, p);
    },
    [status],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Deals"
        action={
          <div className="flex gap-2">
            <Link href="/dashboard/deals">
              <Button variant="secondary">Board view</Button>
            </Link>
            <Link href="/dashboard/deals/new">
              <Button>New deal</Button>
            </Link>
          </div>
        }
      />
      <DataTable
        columns={columns}
        fetchPage={fetchPage}
        reloadKey={status}
        onRowClick={(d) => router.push(`/dashboard/deals/${d.id}`)}
        searchPlaceholder="Search deals…"
        emptyLabel="No deals yet."
        filters={[
          {
            label: 'Status',
            value: status,
            onChange: setStatus,
            options: [
              { label: 'Open', value: 'OPEN' },
              { label: 'Won', value: 'WON' },
              { label: 'Lost', value: 'LOST' },
            ],
          },
        ]}
      />
    </div>
  );
}
