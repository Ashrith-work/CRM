'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import type { Deal } from '@crm/types';
import { listDeals } from '@/lib/api';
import { Card, formatMoney } from './ui';

const STATUS_BADGE: Record<string, string> = {
  OPEN: 'bg-brand-50 text-brand-700',
  WON: 'bg-green-50 text-green-700',
  LOST: 'bg-red-50 text-red-700',
};

/** Deals linked to a contact or company, shown on their M1 detail pages. */
export function DealsSection({ contactId, companyId }: { contactId?: string; companyId?: string }) {
  const { getToken } = useAuth();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await listDeals(getToken, { contactId, companyId, limit: 100 });
      setDeals(res.data);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [getToken, contactId, companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const newHref = `/dashboard/deals/new?${contactId ? `contactId=${contactId}` : `companyId=${companyId}`}`;

  return (
    <Card
      title={`Deals (${deals.length})`}
      action={
        <Link href={newHref} className="text-sm font-medium text-brand-600 hover:underline">
          + New deal
        </Link>
      }
    >
      {error && <p className="text-sm text-red-600">{error}</p>}
      {deals.length === 0 ? (
        <p className="text-sm text-slate-400">No deals yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {deals.map((d) => (
            <li key={d.id} className="flex items-center justify-between py-2">
              <Link href={`/dashboard/deals/${d.id}`} className="text-sm text-brand-600 hover:underline">
                {d.name}
              </Link>
              <span className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-700">{formatMoney(d.amountMinor, d.currency)}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[d.status]}`}>{d.status}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
