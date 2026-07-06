'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { LEAD_STATUSES, type Lead, type LeadStatus } from '@crm/types';
import { useAuth } from '@clerk/nextjs';
import { convertLead, deleteLead, getLead, updateLeadStatus } from '@/lib/api';
import { Button, Card, ErrorPanel, PageHeader, Row, Spinner } from '@/components/crm/ui';
import { CustomFieldView } from '@/components/crm/CustomFieldView';
import { TagList } from '@/components/crm/TagPicker';
import { NoteList } from '@/components/crm/NoteList';
import { Timeline } from '@/components/crm/Timeline';

const SELECTABLE = LEAD_STATUSES.filter((s) => s !== 'CONVERTED');

export default function LeadDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { getToken } = useAuth();
  const [lead, setLead] = useState<Lead | null>(null);
  const [error, setError] = useState('');
  const [timelineKey, setTimelineKey] = useState(0);
  const [companyName, setCompanyName] = useState('');
  const [converting, setConverting] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) throw new Error('No session token available');
      setLead(await getLead(token, id));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [getToken, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const changeStatus = async (status: LeadStatus) => {
    setBusy(true);
    try {
      const token = await getToken();
      if (!token) return;
      setLead(await updateLeadStatus(token, id, status));
      setTimelineKey((k) => k + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doConvert = async () => {
    setBusy(true);
    setError('');
    try {
      const token = await getToken();
      if (!token) return;
      const res = await convertLead(token, id, { companyName: companyName.trim() || undefined });
      router.push(`/dashboard/contacts/${res.contact.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm('Delete this lead?')) return;
    const token = await getToken();
    if (!token) return;
    await deleteLead(token, id);
    router.push('/dashboard/leads');
  };

  if (error && !lead) return <ErrorPanel message={error} onRetry={() => void load()} />;
  if (!lead) return <Spinner />;
  const converted = lead.status === 'CONVERTED';

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${lead.firstName} ${lead.lastName}`}
        subtitle={lead.source ? `Source: ${lead.source}` : undefined}
        action={
          <div className="flex gap-2">
            <Link href={`/dashboard/leads/${id}/edit`}>
              <Button variant="secondary">Edit</Button>
            </Link>
            <Button variant="danger" onClick={() => void remove()}>
              Delete
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        {lead.email && (
          <a href={`mailto:${lead.email}`}>
            <Button variant="secondary">Email</Button>
          </a>
        )}
        {lead.phone && (
          <a href={`tel:${lead.phone}`}>
            <Button variant="secondary">Call</Button>
          </a>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Details">
          <Row label="Email" value={lead.email ?? '—'} />
          <Row label="Phone" value={lead.phone ?? '—'} />
          <Row label="Source" value={lead.source ?? '—'} />
          <div className="mt-3">
            <TagList tags={lead.tags} />
          </div>
        </Card>

        <Card title="Status & conversion">
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Status</span>
              <select
                value={converted ? 'CONVERTED' : lead.status}
                disabled={converted || busy}
                onChange={(e) => void changeStatus(e.target.value as LeadStatus)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 disabled:bg-slate-100"
              >
                {converted && <option value="CONVERTED">CONVERTED</option>}
                {SELECTABLE.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>

            {converted ? (
              <p className="text-sm text-green-700">
                Converted.{' '}
                {lead.convertedContactId && (
                  <Link href={`/dashboard/contacts/${lead.convertedContactId}`} className="text-brand-600 hover:underline">
                    View contact →
                  </Link>
                )}
              </p>
            ) : converting ? (
              <div className="space-y-2 rounded-lg border border-slate-200 p-3">
                <input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="New company name (optional)"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
                />
                <div className="flex gap-2">
                  <Button onClick={() => void doConvert()} disabled={busy}>
                    {busy ? 'Converting…' : 'Confirm convert'}
                  </Button>
                  <Button variant="secondary" onClick={() => setConverting(false)}>
                    Cancel
                  </Button>
                </div>
                <p className="text-xs text-slate-400">
                  A contact is created (or matched by email); the lead is marked CONVERTED.
                </p>
              </div>
            ) : (
              <Button onClick={() => setConverting(true)}>Convert to contact</Button>
            )}
            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>
        </Card>

        <Card title="Custom fields">
          <CustomFieldView entityType="LEAD" values={lead.customFields} />
        </Card>

        <Card title="Notes">
          <NoteList entityType="LEAD" entityId={id} onAdded={() => setTimelineKey((k) => k + 1)} />
        </Card>

        <Card title="Activity">
          <Timeline entityType="LEAD" entityId={id} refreshKey={timelineKey} />
        </Card>
      </div>
    </div>
  );
}
