'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import type { Call, Consent } from '@crm/types';
import { clickToCall, listCalls, listConsents, setConsent } from '@/lib/api';
import { Button, Card, formatDate } from './ui';
import { CallStatusBadge, ConsentBadge, DirectionIcon, formatCallDuration } from './callUi';

/** Calls + call-recording consent for a contact, on its detail page. */
export function CallsSection({ contactId, contactPhone }: { contactId: string; contactPhone: string | null }) {
  const { getToken } = useAuth();
  const [calls, setCalls] = useState<Call[]>([]);
  const [consent, setConsentState] = useState<Consent | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const [callsRes, consents] = await Promise.all([
        listCalls(getToken, { contactId, limit: 20 }),
        listConsents(getToken, contactId),
      ]);
      setCalls(callsRes.data);
      setConsentState(consents.data.find((c) => c.purpose === 'CALL_RECORDING') ?? null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [getToken, contactId]);

  useEffect(() => {
    void load();
  }, [load]);

  const call = async () => {
    setBusy(true);
    setNote('');
    setError('');
    try {
      await clickToCall(getToken, { contactId });
      setNote('Dialing… connecting your line to the contact.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const changeConsent = async (status: 'GRANTED' | 'WITHDRAWN') => {
    if (status === 'WITHDRAWN' && !confirm('Withdraw consent? Any stored recordings for this contact will be purged.')) {
      return;
    }
    setBusy(true);
    try {
      await setConsent(getToken, { contactId, purpose: 'CALL_RECORDING', status, source: 'EXPLICIT' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const consentStatus = consent?.status ?? 'NOT_CAPTURED';

  return (
    <Card
      title={`Calls (${calls.length})`}
      action={
        <Button onClick={() => void call()} disabled={busy || !contactPhone}>
          📞 Call
        </Button>
      }
    >
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      {note && <p className="mb-2 text-sm text-green-600">{note}</p>}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ConsentBadge status={consentStatus} />
        {consentStatus !== 'GRANTED' && (
          <Button variant="secondary" onClick={() => void changeConsent('GRANTED')} disabled={busy}>
            Grant consent
          </Button>
        )}
        {consentStatus === 'GRANTED' && (
          <Button variant="danger" onClick={() => void changeConsent('WITHDRAWN')} disabled={busy}>
            Withdraw
          </Button>
        )}
      </div>

      {calls.length === 0 ? (
        <p className="text-sm text-slate-400">No calls yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {calls.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <Link href={`/dashboard/calls/${c.id}`} className="flex items-center gap-2">
                <DirectionIcon direction={c.direction} />
                <span className="text-slate-600">{c.startedAt ? formatDate(c.startedAt) : '—'}</span>
                {c.recordingAvailable && <span title="Recording available">▶</span>}
              </Link>
              <span className="flex items-center gap-2">
                <span className="text-slate-500">{formatCallDuration(c.durationSeconds)}</span>
                <CallStatusBadge status={c.status} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
