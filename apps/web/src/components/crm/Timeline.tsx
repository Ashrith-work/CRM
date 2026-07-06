'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import type { ActivityEvent, EntityType } from '@crm/types';
import { listActivity } from '@/lib/api';
import { actorName, formatDate } from './ui';

function describe(event: ActivityEvent): string {
  const meta = (event.metadata ?? {}) as Record<string, unknown>;
  switch (event.eventType) {
    case 'CREATED':
      return 'created this record';
    case 'UPDATED':
      return 'updated this record';
    case 'NOTE_ADDED':
      return 'added a note';
    case 'TAG_ADDED':
      return 'added a tag';
    case 'STATUS_CHANGED':
      return `changed status ${meta.from ?? '?'} → ${meta.to ?? '?'}`;
    case 'CONVERTED':
      return 'converted the lead to a contact';
    case 'STAGE_CHANGED':
      return meta.dealName
        ? `moved deal “${meta.dealName}” to ${meta.toStageName ?? 'a new stage'}`
        : `moved to ${meta.toStageName ?? 'a new stage'}`;
    case 'WON':
      return meta.dealName ? `won deal “${meta.dealName}”` : 'marked this won';
    case 'LOST':
      return meta.dealName ? `lost deal “${meta.dealName}”` : 'marked this lost';
    case 'REOPENED':
      return meta.dealName ? `reopened deal “${meta.dealName}”` : 'reopened this';
    default:
      return event.eventType;
  }
}

const DOT: Record<string, string> = {
  CREATED: 'bg-brand-500',
  UPDATED: 'bg-slate-400',
  NOTE_ADDED: 'bg-amber-500',
  TAG_ADDED: 'bg-sky-500',
  STATUS_CHANGED: 'bg-violet-500',
  CONVERTED: 'bg-green-500',
  STAGE_CHANGED: 'bg-indigo-500',
  WON: 'bg-green-600',
  LOST: 'bg-red-500',
  REOPENED: 'bg-amber-500',
};

/**
 * Reads the entity's ActivityEvent feed and renders it newest-first. Accepts a
 * `refreshKey` so parents can force a reload after a mutation.
 */
export function Timeline({
  entityType,
  entityId,
  refreshKey = 0,
}: {
  entityType: EntityType;
  entityId: string;
  refreshKey?: number;
}) {
  const { getToken } = useAuth();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await listActivity(token, entityType, entityId);
      setEvents(res.data);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [getToken, entityType, entityId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (events.length === 0) return <p className="text-sm text-slate-400">No activity yet.</p>;

  return (
    <ol className="space-y-3">
      {events.map((event) => (
        <li key={event.id} className="flex gap-3">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[event.eventType] ?? 'bg-slate-400'}`} />
          <div className="text-sm">
            <p className="text-slate-800">
              <span className="font-medium">{actorName(event.actor)}</span> {describe(event)}
            </p>
            <p className="text-xs text-slate-400">{formatDate(event.createdAt)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
