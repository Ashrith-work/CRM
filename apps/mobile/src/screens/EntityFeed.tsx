import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import type { ActivityEvent, EntityType } from '@crm/types';
import { Card, colors, ErrorBox, Loading, PrimaryButton } from '../ui';
import { useAuthedLoad } from '../useAuthedLoad';
import { createNote, listActivity, listNotes } from '../api';

function actorName(actor: { firstName: string | null; lastName: string | null; email: string } | null): string {
  if (!actor) return 'Someone';
  return [actor.firstName, actor.lastName].filter(Boolean).join(' ') || actor.email;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString();
}

/** Notes list + add-note composer. */
export function NotesSection({
  entityType,
  entityId,
  refreshToken,
  onChanged,
}: {
  entityType: EntityType;
  entityId: string;
  refreshToken: number;
  onChanged: () => void;
}): React.JSX.Element {
  const { getToken } = useAuth();
  const { state, reload } = useAuthedLoad(
    (t) => listNotes(t, entityType, entityId),
    [entityType, entityId, refreshToken],
  );
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('No session token');
      await createNote(token, { entityType, entityId, body: body.trim() });
      setBody('');
      await reload();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Notes">
      <TextInput
        style={styles.noteInput}
        placeholder="Add a note…"
        value={body}
        onChangeText={setBody}
        multiline
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={{ marginTop: 8 }}>
        <PrimaryButton title="Add note" onPress={() => void submit()} busy={busy} disabled={!body.trim()} />
      </View>

      <View style={{ marginTop: 12, gap: 10 }}>
        {state.status === 'loading' && <Loading />}
        {state.status === 'error' && <ErrorBox message={state.message} onRetry={() => void reload()} />}
        {state.status === 'ready' && state.data.data.length === 0 && (
          <Text style={styles.muted}>No notes yet.</Text>
        )}
        {state.status === 'ready' &&
          state.data.data.map((n) => (
            <View key={n.id} style={styles.note}>
              <Text style={styles.noteBody}>{n.body}</Text>
              <Text style={styles.noteMeta}>
                {actorName(n.author)} · {when(n.createdAt)}
              </Text>
            </View>
          ))}
      </View>
    </Card>
  );
}

function describe(ev: ActivityEvent): string {
  switch (ev.eventType) {
    case 'CREATED':
      return 'Created';
    case 'UPDATED':
      return 'Updated';
    case 'NOTE_ADDED':
      return 'Note added';
    case 'TAG_ADDED':
      return 'Tag added';
    case 'CONVERTED':
      return 'Converted to contact';
    case 'STATUS_CHANGED': {
      const meta = ev.metadata as { from?: string; to?: string } | null;
      return meta?.from && meta?.to ? `Status: ${meta.from} → ${meta.to}` : 'Status changed';
    }
    case 'STAGE_CHANGED': {
      const meta = ev.metadata as { toStageName?: string; dealName?: string } | null;
      const suffix = meta?.dealName ? ` (${meta.dealName})` : '';
      return meta?.toStageName ? `Moved to ${meta.toStageName}${suffix}` : `Stage changed${suffix}`;
    }
    case 'WON':
      return 'Deal won';
    case 'LOST':
      return 'Deal lost';
    case 'REOPENED':
      return 'Deal reopened';
    default:
      return ev.eventType;
  }
}

/** Activity timeline, newest-first. */
export function Timeline({
  entityType,
  entityId,
  refreshToken,
}: {
  entityType: EntityType;
  entityId: string;
  refreshToken: number;
}): React.JSX.Element {
  const { state, reload } = useAuthedLoad(
    (t) => listActivity(t, entityType, entityId),
    [entityType, entityId, refreshToken],
  );

  return (
    <Card title="Activity">
      {state.status === 'loading' && <Loading />}
      {state.status === 'error' && <ErrorBox message={state.message} onRetry={() => void reload()} />}
      {state.status === 'ready' && state.data.data.length === 0 && (
        <Text style={styles.muted}>No activity yet.</Text>
      )}
      {state.status === 'ready' && (
        <View style={{ gap: 10 }}>
          {state.data.data.map((ev) => (
            <View key={ev.id} style={styles.event}>
              <View style={styles.dot} />
              <View style={{ flexShrink: 1 }}>
                <Text style={styles.eventText}>{describe(ev)}</Text>
                <Text style={styles.noteMeta}>
                  {actorName(ev.actor)} · {when(ev.createdAt)}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  noteInput: {
    borderWidth: 1,
    borderColor: colors.borderInput,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    minHeight: 60,
    textAlignVertical: 'top',
    backgroundColor: '#fff',
  },
  error: { color: colors.danger, marginTop: 6 },
  muted: { color: colors.muted },
  note: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 },
  noteBody: { color: colors.text, fontSize: 15 },
  noteMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  event: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand, marginTop: 6 },
  eventText: { color: colors.text, fontSize: 15, fontWeight: '500' },
});
