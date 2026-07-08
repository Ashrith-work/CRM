'use client';

import { useRouter } from 'next/navigation';
import type { CustomerListItem } from '@crm/types';
import { listCustomers, type TokenGetter } from '@/lib/api';
import { DataTable, type Column } from '@/components/crm/DataTable';
import { PageHeader, dateOnly, formatMoney } from '@/components/crm/ui';

export default function CustomersPage() {
  const router = useRouter();

  const columns: Column<CustomerListItem>[] = [
    { key: 'name', header: 'Customer', render: (c) => <span className="font-medium text-slate-800 dark:text-slate-100">{c.name}</span> },
    { key: 'email', header: 'Email', render: (c) => <span className="text-slate-500 dark:text-slate-400">{c.email ?? '—'}</span> },
    { key: 'orders', header: 'Orders', sortField: 'orderCount', render: (c) => c.orderCount },
    {
      key: 'net',
      header: 'Net revenue',
      sortField: 'netRevenueMinor',
      render: (c) => (c.currency ? formatMoney(c.netRevenueMinor, c.currency) : (c.netRevenueMinor / 100).toFixed(2)),
    },
    { key: 'last', header: 'Last order', sortField: 'lastOrderAt', render: (c) => dateOnly(c.lastOrderAt) },
  ];

  const fetchPage = (getToken: TokenGetter, params: { cursor?: string; limit?: number; search?: string; sort?: string; order?: 'asc' | 'desc' }) =>
    listCustomers(getToken, params);

  return (
    <div className="space-y-4">
      <PageHeader title="Customers" subtitle="Shopify customers — one profile per person." />
      <DataTable
        columns={columns}
        fetchPage={fetchPage}
        onRowClick={(c) => router.push(`/dashboard/customers/${c.id}`)}
        searchPlaceholder="Search name or email…"
        emptyLabel="No customers yet — connect Shopify and run a sync."
      />
    </div>
  );
}
