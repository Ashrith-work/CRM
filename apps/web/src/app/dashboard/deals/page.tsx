'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import type { BoardResponse, BoardColumn, Deal } from '@crm/types';
import { getBoard, listDeals, listPipelines, moveDeal } from '@/lib/api';
import { Button, ErrorPanel, PageHeader, Spinner, formatMoney, dateOnly } from '@/components/crm/ui';

const STAGE_ACCENT: Record<string, string> = {
  OPEN: 'border-t-brand-500',
  WON: 'border-t-green-500',
  LOST: 'border-t-red-400',
};

export default function DealsBoardPage() {
  const { getToken } = useAuth();
  const [pipelines, setPipelines] = useState<Array<{ id: string; name: string }>>([]);
  const [pipelineId, setPipelineId] = useState('');
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [message, setMessage] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [drag, setDrag] = useState<{ dealId: string; fromStageId: string } | null>(null);

  // Load pipelines once, pick the first as the default board.
  useEffect(() => {
    void (async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error('No session token available');
        const res = await listPipelines(token);
        setPipelines(res.data.map((p) => ({ id: p.id, name: p.name })));
        const preferred = res.data.find((p) => p.isDefault) ?? res.data[0];
        if (preferred) setPipelineId(preferred.id);
        else {
          setStatus('ready');
          setBoard(null);
        }
      } catch (err) {
        setMessage((err as Error).message);
        setStatus('error');
      }
    })();
  }, [getToken]);

  const loadBoard = useCallback(async () => {
    if (!pipelineId) return;
    setStatus('loading');
    try {
      const token = await getToken();
      if (!token) throw new Error('No session token available');
      setBoard(await getBoard(token, pipelineId));
      setStatus('ready');
    } catch (err) {
      setMessage((err as Error).message);
      setStatus('error');
    }
  }, [getToken, pipelineId]);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

  const owners = useMemo(() => {
    if (!board) return [];
    const set = new Set<string>();
    board.columns.forEach((c) => c.deals.forEach((d) => d.ownerId && set.add(d.ownerId)));
    return [...set];
  }, [board]);

  // Optimistic move: mutate local board immediately, then reconcile / roll back.
  const handleDrop = async (toStageId: string) => {
    if (!board || !drag) return;
    const { dealId, fromStageId } = drag;
    setDrag(null);
    if (fromStageId === toStageId) return;

    const snapshot = board;
    const optimistic = applyMove(board, dealId, fromStageId, toStageId);
    if (!optimistic) return;
    setBoard(optimistic);

    try {
      const token = await getToken();
      if (!token) throw new Error('No session token available');
      await moveDeal(token, dealId, toStageId);
      await loadBoard(); // reconcile with authoritative totals/status
    } catch (err) {
      setBoard(snapshot); // roll back
      setMessage(`Move failed: ${(err as Error).message}`);
    }
  };

  const loadMore = async (col: BoardColumn) => {
    if (!board || !col.nextCursor) return;
    const token = await getToken();
    if (!token) return;
    const page = await listDeals(token, { pipelineId, stageId: col.stage.id, cursor: col.nextCursor });
    setBoard({
      ...board,
      columns: board.columns.map((c) =>
        c.stage.id === col.stage.id ? { ...c, deals: [...c.deals, ...page.data], nextCursor: page.nextCursor } : c,
      ),
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Deals board"
        subtitle={board ? `${board.totals.count} deals · ${formatMoney(board.totals.sumMinor, 'USD')} · weighted ${formatMoney(board.totals.weightedMinor, 'USD')}` : undefined}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/dashboard/deals/list">
              <Button variant="secondary">Table view</Button>
            </Link>
            <Link href="/dashboard/deals/new">
              <Button>New deal</Button>
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={pipelineId}
          onChange={(e) => setPipelineId(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
        >
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {owners.length > 1 && (
          <select
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
          >
            <option value="">Owner: All</option>
            {owners.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        )}
        <Link href="/dashboard/settings/pipelines" className="ml-auto text-sm text-brand-600 hover:underline">
          Manage pipelines
        </Link>
      </div>

      {message && <ErrorPanel message={message} onRetry={() => void loadBoard()} />}

      {status === 'loading' ? (
        <Spinner />
      ) : status === 'error' && !board ? (
        <ErrorPanel message={message} onRetry={() => void loadBoard()} />
      ) : !board ? (
        <p className="text-sm text-slate-500">No pipelines yet. <Link href="/dashboard/settings/pipelines" className="text-brand-600 hover:underline">Create one.</Link></p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {board.columns.map((col) => {
            const cards = ownerFilter ? col.deals.filter((d) => d.ownerId === ownerFilter) : col.deals;
            return (
              <div
                key={col.stage.id}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => void handleDrop(col.stage.id)}
                className={`flex w-72 shrink-0 flex-col rounded-xl border border-t-2 border-slate-200 bg-slate-50 ${STAGE_ACCENT[col.stage.type] ?? 'border-t-slate-400'}`}
              >
                <div className="border-b border-slate-200 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-700">{col.stage.name}</span>
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-500">{col.totals.count}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {formatMoney(col.totals.sumMinor, 'USD')} · weighted {formatMoney(col.totals.weightedMinor, 'USD')}
                    <span className="ml-1 text-slate-400">({col.stage.probability}%)</span>
                  </div>
                </div>

                <div className="flex-1 space-y-2 p-2">
                  {cards.length === 0 && <p className="px-1 py-6 text-center text-xs text-slate-400">No deals</p>}
                  {cards.map((deal) => (
                    <DealCard key={deal.id} deal={deal} onDragStart={() => setDrag({ dealId: deal.id, fromStageId: col.stage.id })} />
                  ))}
                  {col.nextCursor && (
                    <button
                      onClick={() => void loadMore(col)}
                      className="w-full rounded-lg border border-dashed border-slate-300 py-1.5 text-xs text-slate-500 hover:bg-white"
                    >
                      Load more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DealCard({ deal, onDragStart }: { deal: Deal; onDragStart: () => void }) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="cursor-grab rounded-lg border border-slate-200 bg-white p-3 shadow-sm active:cursor-grabbing"
    >
      <Link href={`/dashboard/deals/${deal.id}`} className="block text-sm font-medium text-slate-800 hover:text-brand-600">
        {deal.name}
      </Link>
      <p className="mt-1 text-sm font-semibold text-slate-700">{formatMoney(deal.amountMinor, deal.currency)}</p>
      <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
        <span>{deal.contact ? `${deal.contact.firstName} ${deal.contact.lastName}` : deal.company?.name ?? '—'}</span>
        <span>{deal.expectedCloseDate ? dateOnly(deal.expectedCloseDate) : ''}</span>
      </div>
    </div>
  );
}

/** Pure optimistic board transform: move a deal between columns and recompute totals. */
function applyMove(board: BoardResponse, dealId: string, fromStageId: string, toStageId: string): BoardResponse | null {
  const from = board.columns.find((c) => c.stage.id === fromStageId);
  const to = board.columns.find((c) => c.stage.id === toStageId);
  const deal = from?.deals.find((d) => d.id === dealId);
  if (!from || !to || !deal) return null;

  const columns = board.columns.map((c) => {
    if (c.stage.id === fromStageId) {
      const sum = c.totals.sumMinor - deal.amountMinor;
      return {
        ...c,
        deals: c.deals.filter((d) => d.id !== dealId),
        totals: { count: c.totals.count - 1, sumMinor: sum, weightedMinor: Math.round((sum * c.stage.probability) / 100) },
      };
    }
    if (c.stage.id === toStageId) {
      const sum = c.totals.sumMinor + deal.amountMinor;
      return {
        ...c,
        deals: [{ ...deal, stageId: toStageId }, ...c.deals],
        totals: { count: c.totals.count + 1, sumMinor: sum, weightedMinor: Math.round((sum * c.stage.probability) / 100) },
      };
    }
    return c;
  });

  const totals = columns.reduce(
    (acc, c) => ({
      count: acc.count + c.totals.count,
      sumMinor: acc.sumMinor + c.totals.sumMinor,
      weightedMinor: acc.weightedMinor + c.totals.weightedMinor,
    }),
    { count: 0, sumMinor: 0, weightedMinor: 0 },
  );

  return { ...board, columns, totals };
}
