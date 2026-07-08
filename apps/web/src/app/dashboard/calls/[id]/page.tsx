'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import type { Call, RecordingUrlResponse } from '@crm/types';
import { getCall, getCallRecording, updateCall } from '@/lib/api';
import { Button, Card, ErrorPanel, PageHeader, Row, Spinner, actorName, formatDate } from '@/components/crm/ui';
import { CallStatusBadge, ConsentBadge, DirectionIcon, formatCallDuration } from '@/components/crm/callUi';

export default function CallDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const { getToken } = useAuth();
  const [state, setState] = useState<{ status: 'loading' | 'error' | 'ready'; call?: Call; message?: string }>({
    status: 'loading',
  });
  const [disposition, setDisposition] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [rec, setRec] = useState<RecordingUrlResponse | null>(null);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const call = await getCall(getToken, id);
      setDisposition(call.disposition ?? '');
      setNotes(call.notes ?? '');
      setState({ status: 'ready', call });
      if (call.recordingStatus === 'STORED') {
        setRec(await getCallRecording(getToken, id).catch(() => null));
      } else {
        setRec(null);
      }
    } catch (err) {
      setState({ status: 'error', message: (err as Error).message });
    }
  }, [getToken, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      await updateCall(getToken, id, { disposition: disposition || null, notes: notes || null });
      await load();
    } finally {
      setSaving(false);
    }
  };

  if (state.status === 'loading') return <Spinner />;
  if (state.status === 'error') return <ErrorPanel message={state.message ?? ''} onRetry={() => void load()} />;
  const c = state.call!;
  const other = c.direction === 'INBOUND' ? c.fromNumber : c.toNumber;

  return (
    <div className="space-y-4">
      <PageHeader
        title={c.contact ? `${c.contact.firstName} ${c.contact.lastName}` : other}
        subtitle={`${c.direction === 'INBOUND' ? 'Inbound' : 'Outbound'} call`}
        action={<CallStatusBadge status={c.status} />}
      />
      {c.ambiguousMatch && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          ⚠️ This number matched multiple contacts — linked to the most recently updated one.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Details" action={<DirectionIcon direction={c.direction} />}>
          <Row label="From" value={c.fromNumber} />
          <Row label="To" value={c.toNumber} />
          <Row label="Agent" value={actorName(c.agent)} />
          <Row label="Started" value={c.startedAt ? formatDate(c.startedAt) : '—'} />
          <Row label="Answered" value={c.answeredAt ? formatDate(c.answeredAt) : '—'} />
          <Row label="Ended" value={c.endedAt ? formatDate(c.endedAt) : '—'} />
          <Row label="Duration" value={formatCallDuration(c.durationSeconds)} />
          <Row
            label="Contact"
            value={
              c.contact ? (
                <Link href={`/dashboard/contacts/${c.contact.id}`} className="text-brand-600 hover:underline">
                  {c.contact.firstName} {c.contact.lastName}
                </Link>
              ) : (
                '—'
              )
            }
          />
          <Row
            label="Deal"
            value={
              c.deal ? (
                <Link href={`/dashboard/deals/${c.deal.id}`} className="text-brand-600 hover:underline">
                  {c.deal.name}
                </Link>
              ) : (
                '—'
              )
            }
          />
          <div className="mt-3">{c.contactId ? <ConsentBadge status={c.consentStatus} /> : null}</div>
        </Card>

        <Card title="Recording">
          {c.recordingStatus === 'STORED' ? (
            rec?.url ? (
              <audio controls src={rec.url} className="w-full">
                Your browser does not support audio playback.
              </audio>
            ) : (
              <p className="text-sm text-slate-500">{rec?.reason ?? 'Preparing recording…'}</p>
            )
          ) : (
            <p className="text-sm text-slate-500">
              {c.recordingStatus === 'BLOCKED'
                ? 'Blocked — no call-recording consent.'
                : c.recordingStatus === 'PENDING'
                  ? 'Recording is being fetched…'
                  : c.recordingStatus === 'FAILED'
                    ? 'Recording fetch failed.'
                    : 'No recording for this call.'}
            </p>
          )}
        </Card>

        <Card title="Disposition & notes">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Disposition</span>
            <input
              value={disposition}
              onChange={(e) => setDisposition(e.target.value)}
              placeholder="e.g. Interested, Callback requested"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </label>
          <label className="mt-3 block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </label>
          <div className="mt-3">
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
