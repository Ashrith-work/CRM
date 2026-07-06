'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import type { Deal, Pipeline, StageHistory } from '@crm/types';
import { deleteDeal, getDeal, getDealHistory, getPipeline, moveDeal, reopenDeal } from '@/lib/api';
import { Button, Card, ErrorPanel, PageHeader, Row, Spinner, actorName, dateOnly, formatDate, formatDuration, formatMoney } from '@/components/crm/ui';
import { CustomFieldView } from '@/components/crm/CustomFieldView';
import { TagList } from '@/components/crm/TagPicker';
import { NoteList } from '@/components/crm/NoteList';
import { Timeline } from '@/components/crm/Timeline';

const STATUS_BADGE: Record<string, string> = {
  OPEN: 'bg-brand-50 text-brand-700',
  WON: 'bg-green-50 text-green-700',
  LOST: 'bg-red-50 text-red-700',
};

export default function DealDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { getToken } = useAuth();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [history, setHistory] = useState<StageHistory[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [timelineKey, setTimelineKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) throw new Error('No session token available');
      const d = await getDeal(token, id);
      setDeal(d);
      const [p, h] = await Promise.all([getPipeline(token, d.pipelineId), getDealHistory(token, id)]);
      setPipeline(p);
      setHistory(h.data);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [getToken, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const runMove = async (toStageId: string) => {
    setBusy(true);
    setError('');
    try {
      const token = await getToken();
      if (!token) return;
      await moveDeal(token, id, toStageId);
      await load();
      setTimelineKey((k) => k + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const runReopen = async () => {
    setBusy(true);
    setError('');
    try {
      const token = await getToken();
      if (!token) return;
      await reopenDeal(token, id);
      await load();
      setTimelineKey((k) => k + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm('Delete this deal?')) return;
    const token = await getToken();
    if (!token) return;
    await deleteDeal(token, id);
    router.push('/dashboard/deals');
  };

  if (error && !deal) return <ErrorPanel message={error} onRetry={() => void load()} />;
  if (!deal) return <Spinner />;

  const stageName = pipeline?.stages.find((s) => s.id === deal.stageId)?.name ?? '—';
  const openStages = pipeline?.stages.filter((s) => s.type === 'OPEN') ?? [];
  const wonStage = pipeline?.stages.find((s) => s.type === 'WON');
  const lostStage = pipeline?.stages.find((s) => s.type === 'LOST');

  return (
    <div className="space-y-4">
      <PageHeader
        title={deal.name}
        subtitle={formatMoney(deal.amountMinor, deal.currency)}
        action={
          <div className="flex gap-2">
            <Link href={`/dashboard/deals/${id}/edit`}>
              <Button variant="secondary">Edit</Button>
            </Link>
            <Button variant="danger" onClick={() => void remove()}>
              Delete
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_BADGE[deal.status]}`}>{deal.status}</span>
        {deal.status === 'OPEN' ? (
          <>
            <label className="text-sm text-slate-600">
              Stage:{' '}
              <select
                value={deal.stageId}
                disabled={busy}
                onChange={(e) => void runMove(e.target.value)}
                className="rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-brand-500"
              >
                {openStages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
                {!openStages.some((s) => s.id === deal.stageId) && <option value={deal.stageId}>{stageName}</option>}
              </select>
            </label>
            {wonStage && (
              <Button variant="secondary" disabled={busy} onClick={() => void runMove(wonStage.id)}>
                Mark Won
              </Button>
            )}
            {lostStage && (
              <Button variant="secondary" disabled={busy} onClick={() => void runMove(lostStage.id)}>
                Mark Lost
              </Button>
            )}
          </>
        ) : (
          <Button variant="secondary" disabled={busy} onClick={() => void runReopen()}>
            Reopen
          </Button>
        )}
      </div>

      {error && <ErrorPanel message={error} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Details">
          <Row label="Amount" value={formatMoney(deal.amountMinor, deal.currency)} />
          <Row label="Stage" value={stageName} />
          <Row label="Owner" value={deal.ownerId ?? '—'} />
          <Row label="Expected close" value={dateOnly(deal.expectedCloseDate)} />
          {deal.closedAt && <Row label="Closed" value={dateOnly(deal.closedAt)} />}
          <Row
            label="Contact"
            value={
              deal.contact ? (
                <Link href={`/dashboard/contacts/${deal.contact.id}`} className="text-brand-600 hover:underline">
                  {deal.contact.firstName} {deal.contact.lastName}
                </Link>
              ) : (
                '—'
              )
            }
          />
          <Row
            label="Company"
            value={
              deal.company ? (
                <Link href={`/dashboard/companies/${deal.company.id}`} className="text-brand-600 hover:underline">
                  {deal.company.name}
                </Link>
              ) : (
                '—'
              )
            }
          />
          <div className="mt-3">
            <TagList tags={deal.tags} />
          </div>
          {deal.contact && (
            <div className="mt-3 flex gap-2">
              {deal.contact.email && (
                <a href={`mailto:${deal.contact.email}`}>
                  <Button variant="secondary">Email</Button>
                </a>
              )}
              {deal.contact.phone && (
                <a href={`tel:${deal.contact.phone}`}>
                  <Button variant="secondary">Call</Button>
                </a>
              )}
            </div>
          )}
        </Card>

        <Card title="Custom fields">
          <CustomFieldView entityType="DEAL" values={deal.customFields} />
        </Card>

        <Card title="Stage history">
          {history.length === 0 ? (
            <p className="text-sm text-slate-400">No stage changes yet.</p>
          ) : (
            <ol className="space-y-2">
              {history.map((h) => (
                <li key={h.id} className="flex items-start justify-between gap-3 text-sm">
                  <div>
                    <p className="text-slate-800">
                      {h.fromStageName ? `${h.fromStageName} → ` : 'Created in '}
                      <span className="font-medium">{h.toStageName ?? '—'}</span>
                    </p>
                    <p className="text-xs text-slate-400">
                      {actorName(h.changedBy)} · {formatDate(h.changedAt)}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-500">{formatDuration(h.secondsInPreviousStage)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card title="Notes">
          <NoteList entityType="DEAL" entityId={id} onAdded={() => setTimelineKey((k) => k + 1)} />
        </Card>

        <Card title="Activity">
          <Timeline entityType="DEAL" entityId={id} refreshKey={timelineKey} />
        </Card>
      </div>
    </div>
  );
}
