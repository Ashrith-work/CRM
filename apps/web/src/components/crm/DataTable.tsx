'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Button, ErrorPanel, Spinner } from './ui';
import type { ListParams } from '@/lib/api';

export interface Column<T> {
  key: string;
  header: string;
  /** Field name for server-side sort; omit to make the column unsortable. */
  sortField?: string;
  render: (row: T) => ReactNode;
}

export interface DataTableFilter {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
}

interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

/**
 * Reusable server-paginated table: debounced search, optional filters,
 * click-to-sort headers, cursor "Load more", and row navigation. Generic over
 * the row type; the caller supplies a `fetchPage(token, params)` function.
 */
export function DataTable<T extends { id: string }>({
  columns,
  fetchPage,
  onRowClick,
  filters = [],
  searchPlaceholder = 'Search…',
  emptyLabel = 'Nothing here yet.',
  // Bump this to force a reload (e.g. when a filter value changes).
  reloadKey = '',
}: {
  columns: Column<T>[];
  fetchPage: (token: string, params: ListParams) => Promise<Page<T>>;
  onRowClick?: (row: T) => void;
  filters?: DataTableFilter[];
  searchPlaceholder?: string;
  emptyLabel?: string;
  reloadKey?: string;
}) {
  const { getToken } = useAuth();
  const [rows, setRows] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<string | undefined>(undefined);
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (append: boolean) => {
      if (!append) setStatus('loading');
      try {
        const token = await getToken();
        if (!token) throw new Error('No session token available');
        const page = await fetchPage(token, {
          search: search || undefined,
          sort,
          order,
          cursor: append && cursor ? cursor : undefined,
        });
        setRows((prev) => (append ? [...prev, ...page.data] : page.data));
        setCursor(page.nextCursor);
        setStatus('ready');
      } catch (err) {
        setMessage((err as Error).message);
        setStatus('error');
      }
    },
    [getToken, fetchPage, search, sort, order, cursor],
  );

  // Reload on search/sort/filter change (search is debounced).
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void load(false), 250);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, sort, order, reloadKey]);

  const toggleSort = (field?: string) => {
    if (!field) return;
    if (sort === field) setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(field);
      setOrder('asc');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={searchPlaceholder}
          className="min-w-[12rem] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />
        {filters.map((f) => (
          <select
            key={f.label}
            value={f.value}
            onChange={(e) => f.onChange(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
          >
            <option value="">{f.label}: All</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ))}
      </div>

      {status === 'error' ? (
        <ErrorPanel message={message} onRetry={() => void load(false)} />
      ) : status === 'loading' ? (
        <Spinner />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    onClick={() => toggleSort(c.sortField)}
                    className={`px-4 py-2.5 font-semibold ${c.sortField ? 'cursor-pointer select-none hover:text-slate-700' : ''}`}
                  >
                    {c.header}
                    {c.sortField && sort === c.sortField ? (order === 'asc' ? ' ↑' : ' ↓') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-8 text-center text-slate-400">
                    {emptyLabel}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => onRowClick?.(row)}
                    className={`border-b border-slate-100 last:border-0 ${onRowClick ? 'cursor-pointer hover:bg-slate-50' : ''}`}
                  >
                    {columns.map((c) => (
                      <td key={c.key} className="px-4 py-2.5">
                        {c.render(row)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {status === 'ready' && cursor && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={() => void load(true)}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
