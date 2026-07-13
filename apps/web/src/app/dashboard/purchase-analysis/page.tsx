'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import type {
  CustomerSuggestion,
  EscalationStatus,
  EscalationSummaryDto,
  PurchaseOrderRow,
  PurchaseProfile,
} from '@crm/types';
import {
  addEscalation,
  getPurchaseProfile,
  listEscalations,
  lookupCustomer,
  suggestCustomers,
} from '@/lib/api';
import { Card, PageHeader, Button, Spinner, ErrorPanel, formatMoney, formatDate } from '@/components/crm/ui';
import { InfoTooltip } from '@/components/crm/InfoTooltip';
import { EmptyState } from '@/components/crm/EmptyState';

export default function PurchaseAnalysisPage() {
  const { getToken } = useAuth();

  // Lookup input + typeahead.
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<CustomerSuggestion[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [candidates, setCandidates] = useState<CustomerSuggestion[]>([]);
  const [lookupMsg, setLookupMsg] = useState('');

  // Resolved customer + data.
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [profile, setProfile] = useState<PurchaseProfile | null>(null);
  const [escalations, setEscalations] = useState<EscalationSummaryDto[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle');
  const [message, setMessage] = useState('');

  const selectedRef = useRef(false); // suppress typeahead right after a selection

  // ----- Typeahead (debounced) ------------------------------------------------
  useEffect(() => {
    if (selectedRef.current) { selectedRef.current = false; return; }
    const q = query.trim();
    if (q.length < 2) { setSuggestions([]); return; }
    const handle = setTimeout(() => {
      suggestCustomers(getToken, q).then((r) => { setSuggestions(r.data); setShowSuggest(true); }).catch(() => setSuggestions([]));
    }, 300);
    return () => clearTimeout(handle);
  }, [query, getToken]);

  const loadCustomer = useCallback(async (id: string) => {
    setCustomerId(id);
    setStatus('loading');
    setCandidates([]);
    setLookupMsg('');
    try {
      const [p, esc] = await Promise.all([getPurchaseProfile(getToken, id), listEscalations(getToken, id)]);
      setProfile(p);
      setEscalations(esc.data);
      setStatus('ready');
    } catch (err) {
      setMessage((err as Error).message);
      setStatus('error');
    }
  }, [getToken]);

  const selectSuggestion = (s: CustomerSuggestion) => {
    selectedRef.current = true;
    setQuery(s.name);
    setShowSuggest(false);
    setSuggestions([]);
    void loadCustomer(s.id);
  };

  const onLookup = async () => {
    const q = query.trim();
    if (!q) return;
    setShowSuggest(false);
    setCandidates([]);
    setLookupMsg('');
    try {
      const r = await lookupCustomer(getToken, q);
      if (r.match) return void loadCustomer(r.match.id);
      if (r.candidates.length) { setCandidates(r.candidates); setLookupMsg(`${r.candidates.length} customers match "${q}" — pick one:`); return; }
      setLookupMsg(`No customer found for "${q}".`);
      setProfile(null);
      setCustomerId(null);
    } catch (err) {
      setLookupMsg((err as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Purchase Analysis"
        subtitle="Look up a customer by phone, email, or name to see their recent purchases and escalations."
      />

      {/* Lookup input + typeahead */}
      <Card>
        <div className="relative flex flex-wrap items-center gap-2">
          <div className="relative min-w-[280px] flex-1">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void onLookup(); }}
              onFocus={() => suggestions.length && setShowSuggest(true)}
              placeholder="Phone, email, or name…"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              aria-label="Customer lookup"
              autoComplete="off"
            />
            {showSuggest && suggestions.length > 0 && (
              <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
                {suggestions.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => selectSuggestion(s)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700"
                    >
                      <span className="font-medium text-slate-800 dark:text-slate-100">{s.name}</span>
                      <span className="truncate text-xs text-slate-400">{s.email ?? s.externalId ?? ''} · {s.orderCount} orders</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Button onClick={onLookup}>Look up</Button>
        </div>
        {lookupMsg && <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">{lookupMsg}</p>}
        {candidates.length > 0 && (
          <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {candidates.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => selectSuggestion(c)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
                  <span className="font-medium text-slate-800 dark:text-slate-100">{c.name}</span>
                  <span className="text-xs text-slate-400">{c.email ?? c.externalId ?? ''} · {c.orderCount} orders</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {status === 'loading' ? (
        <Spinner />
      ) : status === 'error' ? (
        <ErrorPanel message={message} onRetry={() => customerId && loadCustomer(customerId)} />
      ) : status === 'ready' && profile ? (
        <>
          <CustomerContext profile={profile} />
          <OrdersTable orders={profile.orders} />
          {customerId && (
            <EscalationPanel
              customerId={customerId}
              escalations={escalations}
              orders={profile.orders}
              onAdded={(e) => setEscalations((prev) => [e, ...prev])}
              getToken={getToken}
            />
          )}
        </>
      ) : (
        <EmptyState icon="🔎" title="Look up a customer" description="Search by phone, email, or name (type to see matches) to view their purchase profile." />
      )}
    </div>
  );
}

function CustomerContext({ profile }: { profile: PurchaseProfile }) {
  const c = profile.customer;
  const cur = c.currency ?? 'INR';
  return (
    <Card title="Customer">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
        <div>
          <p className="text-lg font-bold text-slate-900 dark:text-slate-100">{c.name}</p>
          <p className="text-xs text-slate-400">{c.email ?? '—'}{c.phone ? ` · ${c.phone}` : ''}{c.masked ? ' · masked' : ''}</p>
        </div>
        <Stat label="Segment" value={c.segment ?? '—'} metricKey="rfm" />
        <Stat label="Total orders" value={c.totalOrders.toLocaleString()} metricKey="order_count" />
        <Stat label="Net revenue" value={formatMoney(c.netRevenueMinor, cur)} metricKey="net_revenue" />
        <Stat label="CLV" value={c.clvMinor != null ? `${formatMoney(c.clvMinor, cur)}${c.clvBand ? ` (${c.clvBand})` : ''}` : '—'} metricKey="clv" />
        <Stat label="Last order" value={c.lastOrderAt ? formatDate(c.lastOrderAt) : '—'} metricKey="last_order" />
      </div>
    </Card>
  );
}

function Stat({ label, value, metricKey }: { label: string; value: string; metricKey?: string }) {
  return (
    <div>
      <p className="flex items-center text-xs font-semibold uppercase tracking-wide text-slate-500">{label}{metricKey && <InfoTooltip metricKey={metricKey} />}</p>
      <p className="mt-0.5 font-semibold text-slate-800 dark:text-slate-200">{value}</p>
    </div>
  );
}

const COLS = ['Order', 'Segment', 'Mode', 'Value', 'Discount', 'Fabrics', 'Product types', 'Products'];

function OrdersTable({ orders }: { orders: PurchaseOrderRow[] }) {
  return (
    <Card title="Recent purchases" action={<span className="text-xs text-slate-400">last &amp; 2nd-last order</span>}>
      {orders.length === 0 ? (
        <EmptyState icon="🧾" title="No paid orders" description="This customer has no paid/fulfilled orders yet." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800">
              <tr>{COLS.map((h) => (
                <th key={h} className="px-3 py-2 font-medium">{h === 'Discount' ? <span className="flex items-center">{h}<InfoTooltip metricKey="discount_pct" /></span> : h === 'Fabrics' ? <span className="flex items-center">{h}<InfoTooltip metricKey="fabrics" /></span> : h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {orders.map((o, i) => (
                <tr key={o.orderId} className="border-b border-slate-100 align-top last:border-0 dark:border-slate-800">
                  <td className="px-3 py-2">
                    <span className="font-medium text-slate-800 dark:text-slate-100">#{o.orderNumber ?? o.orderId.slice(-6)}</span>
                    <span className="block text-xs text-slate-400">{i === 0 ? 'Last' : '2nd-last'} · {formatDate(o.placedAt)}</span>
                  </td>
                  <td className="px-3 py-2">{o.segment ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-300 dark:text-slate-600" title="Reserved (POS location → store)">—</td>
                  <td className="px-3 py-2 font-medium tabular-nums">{formatMoney(o.valueMinor, o.currency)}</td>
                  <td className="px-3 py-2">
                    {o.discount ? (
                      <span className="text-slate-700 dark:text-slate-300">
                        {o.discount.code ?? '(code-less)'} · {formatMoney(o.discount.amountMinor, o.currency)}
                        {o.discount.pct != null && <span className="text-slate-400"> ({(o.discount.pct * 100).toFixed(1)}%)</span>}
                      </span>
                    ) : (
                      <span className="text-slate-400">No discount</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{o.fabrics.length ? o.fabrics.join(', ') : <span className="text-slate-400">-</span>}</td>
                  <td className="px-3 py-2">{o.productTypes.length ? o.productTypes.join(', ') : <span className="text-slate-400">-</span>}</td>
                  <td className="px-3 py-2">
                    {o.products.map((p, j) => (
                      <span key={j} className="block text-slate-700 dark:text-slate-300">{p.title}{p.variant ? <span className="text-slate-400"> ({p.variant})</span> : ''}</span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function EscalationPanel({
  customerId,
  escalations,
  orders,
  onAdded,
  getToken,
}: {
  customerId: string;
  escalations: EscalationSummaryDto[];
  orders: PurchaseOrderRow[];
  onAdded: (e: EscalationSummaryDto) => void;
  getToken: ReturnType<typeof useAuth>['getToken'];
}) {
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<EscalationStatus | ''>('');
  const [orderId, setOrderId] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!note.trim()) return;
    setSaving(true);
    setErr('');
    try {
      const created = await addEscalation(getToken, customerId, {
        note: note.trim(),
        status: status || undefined,
        orderId: orderId || undefined,
      });
      onAdded(created);
      setNote('');
      setStatus('');
      setOrderId('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';
  return (
    <Card title="Escalation summary" action={<span className="text-xs text-slate-400">{escalations.length} logged</span>}>
      <div className="space-y-2">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add an escalation note (e.g. quality issue, delivery complaint)…"
          rows={2}
          className={`${inputCls} w-full`}
        />
        <div className="flex flex-wrap items-center gap-2">
          <select value={status} onChange={(e) => setStatus(e.target.value as EscalationStatus | '')} className={inputCls} aria-label="Status">
            <option value="">No status</option>
            <option value="OPEN">Open</option>
            <option value="RESOLVED">Resolved</option>
          </select>
          <select value={orderId} onChange={(e) => setOrderId(e.target.value)} className={inputCls} aria-label="Related order">
            <option value="">Not order-specific</option>
            {orders.map((o) => <option key={o.orderId} value={o.orderId}>#{o.orderNumber ?? o.orderId.slice(-6)}</option>)}
          </select>
          <Button onClick={submit} disabled={saving || !note.trim()}>{saving ? 'Saving…' : 'Add escalation'}</Button>
        </div>
        {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
      </div>

      <div className="mt-4">
        {escalations.length === 0 ? (
          <p className="text-sm text-slate-400">No escalations yet. Add the first one above — it also appears on the customer timeline.</p>
        ) : (
          <ul className="space-y-2">
            {escalations.map((e) => (
              <li key={e.id} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
                <div className="mb-1 flex items-center gap-2 text-xs text-slate-400">
                  {e.status && <span className={`rounded-full px-2 py-0.5 font-medium ${e.status === 'OPEN' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'}`}>{e.status}</span>}
                  <span>{e.authorName ?? 'Unknown'} · {formatDate(e.createdAt)}</span>
                  {e.orderId && <span>· order #{e.orderId.slice(-6)}</span>}
                </div>
                <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-300">{e.note}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
