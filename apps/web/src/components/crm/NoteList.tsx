'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import type { EntityType, Note } from '@crm/types';
import { createNote, listNotes } from '@/lib/api';
import { Button, actorName, formatDate } from './ui';

/**
 * Notes panel for an entity: newest-first list plus an inline composer. A new
 * note also surfaces on the Timeline (the API emits NOTE_ADDED), so the caller
 * can pass `onAdded` to refresh the timeline.
 */
export function NoteList({
  entityType,
  entityId,
  onAdded,
}: {
  entityType: EntityType;
  entityId: string;
  onAdded?: () => void;
}) {
  const { getToken } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await listNotes(getToken, entityType, entityId);
      setNotes(res.data);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [getToken, entityType, entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setError('');
    try {
      const note = await createNote(getToken, { entityType, entityId, body: text });
      setNotes((prev) => [note, ...prev]);
      setBody('');
      onAdded?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a note…"
          rows={2}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />
        <Button onClick={() => void submit()} disabled={busy || !body.trim()}>
          {busy ? 'Adding…' : 'Add note'}
        </Button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>

      <ul className="space-y-2">
        {notes.length === 0 && <li className="text-sm text-slate-400">No notes yet.</li>}
        {notes.map((note) => (
          <li key={note.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="whitespace-pre-wrap text-sm text-slate-800">{note.body}</p>
            <p className="mt-1 text-xs text-slate-400">
              {actorName(note.author)} · {formatDate(note.createdAt)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
