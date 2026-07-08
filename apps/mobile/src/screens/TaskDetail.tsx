import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import type { OrgUser, Task } from '@crm/types';
import { Card, colors, ErrorBox, Loading, Pill, PrimaryButton, Row, SecondaryButton } from '../ui';
import { useAuthedLoad } from '../useAuthedLoad';
import { useNav } from '../navigation';
import { completeTask, getTask, listUsers, reassignTask, snoozeTask, type TokenGetter } from '../api';
import { ScreenHeader } from './ScreenHeader';
import { formatWhen, PRIORITY_COLOR, TYPE_LABEL } from './taskShared';

function userName(u: { firstName: string | null; lastName: string | null; email: string }): string {
  return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;
}

export function TaskDetail({ id }: { id: string }): React.JSX.Element {
  const { getToken } = useAuth();
  const { push } = useNav();
  const { state, reload } = useAuthedLoad<{ task: Task; users: OrgUser[] }>(
    async (t) => {
      const [task, users] = await Promise.all([getTask(t, id), listUsers(t)]);
      return { task, users: users.data };
    },
    [id],
  );
  const [outcome, setOutcome] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showReassign, setShowReassign] = useState(false);

  const run = async (fn: (getToken: TokenGetter) => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn(getToken);
      await reload();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const Frame = ({ children }: { children: React.ReactNode }) => (
    <ScrollView contentContainerStyle={styles.container}>
      <ScreenHeader title="Task" />
      <View style={{ gap: 12 }}>{children}</View>
    </ScrollView>
  );

  if (state.status === 'loading') return <Frame><Loading /></Frame>;
  if (state.status === 'error') return <Frame><ErrorBox message={state.message} onRetry={() => void reload()} /></Frame>;

  const { task, users } = state.data;
  const anchor = task.startAt ?? task.dueAt;
  const open = task.status === 'OPEN';

  return (
    <Frame>
      <Card title={TYPE_LABEL[task.type]}>
        <Text style={styles.title}>{task.title}</Text>
        {task.description ? <Text style={styles.desc}>{task.description}</Text> : null}
        <View style={{ height: 8 }} />
        <Row label="When" value={formatWhen(anchor)} />
        {task.endAt ? <Row label="Ends" value={formatWhen(task.endAt)} /> : null}
        {task.location ? <Row label="Location" value={task.location} /> : null}
        <View style={styles.statusLine}>
          <Text style={{ color: colors.muted }}>Priority</Text>
          <Pill label={task.priority} color={PRIORITY_COLOR[task.priority]} />
        </View>
        <View style={styles.statusLine}>
          <Text style={{ color: colors.muted }}>Status</Text>
          <Pill label={task.status} color={open ? colors.brand : '#16a34a'} />
        </View>
        <Row label="Assignee" value={task.assignee ? userName(task.assignee) : task.assigneeId} />
        {task.outcome ? <Row label="Outcome" value={task.outcome} /> : null}
      </Card>

      {task.related ? (
        <Card title="Related">
          <TouchableOpacity
            onPress={() => {
              if (task.related!.type === 'DEAL') push({ name: 'dealDetail', id: task.related!.id });
              else push({ name: 'detail', entity: task.related!.type, id: task.related!.id });
            }}
          >
            <Row label={task.related.type} value={`${task.related.label} ›`} />
          </TouchableOpacity>
        </Card>
      ) : null}

      {task.reminders.length > 0 ? (
        <Card title="Reminders">
          {task.reminders.map((r) => (
            <View key={r.id} style={styles.reminderRow}>
              <Text style={styles.reminderText}>{formatWhen(r.remindAt)}</Text>
              <View style={styles.reminderRight}>
                <Text style={styles.reminderChannels}>{r.channels.join(' · ')}</Text>
                <Pill label={r.status} color={r.status === 'SENT' ? '#16a34a' : r.status === 'CANCELLED' ? colors.muted : colors.brand} />
              </View>
            </View>
          ))}
        </Card>
      ) : null}

      {open ? (
        <Card title="Actions">
          <TextInput
            style={styles.outcomeInput}
            placeholder="Log an outcome (optional)…"
            value={outcome}
            onChangeText={setOutcome}
            multiline
          />
          <View style={{ marginTop: 8, gap: 10 }}>
            <PrimaryButton
              title="Mark done"
              busy={busy}
              onPress={() => void run((token) => completeTask(token, id, outcome.trim() ? { outcome: outcome.trim() } : {}))}
            />
            <View style={styles.snoozeRow}>
              <SecondaryButton
                title="Snooze 1h"
                onPress={() => void run((token) => snoozeTask(token, id, { remindAt: new Date(Date.now() + 3_600_000).toISOString() }))}
              />
              <SecondaryButton
                title="Snooze 1 day"
                onPress={() => void run((token) => snoozeTask(token, id, { remindAt: new Date(Date.now() + 86_400_000).toISOString() }))}
              />
            </View>
            <SecondaryButton title={showReassign ? 'Hide reassign' : 'Reassign'} onPress={() => setShowReassign((v) => !v)} />
            {showReassign ? (
              <View style={styles.userRow}>
                {users.map((u) => (
                  <TouchableOpacity
                    key={u.id}
                    style={[styles.userChip, u.id === task.assigneeId && styles.userChipActive]}
                    disabled={busy}
                    onPress={() => void run((token) => reassignTask(token, id, { assigneeId: u.id }))}
                  >
                    <Text style={[styles.userChipText, u.id === task.assigneeId && styles.userChipTextActive]}>
                      {userName(u)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
          </View>
        </Card>
      ) : null}

      {actionError ? <ErrorBox message={actionError} /> : null}
    </Frame>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 64, backgroundColor: colors.bg, minHeight: '100%' },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  desc: { color: colors.text, marginTop: 6 },
  statusLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 },
  reminderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border },
  reminderText: { color: colors.text, fontWeight: '500' },
  reminderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reminderChannels: { color: colors.muted, fontSize: 12 },
  outcomeInput: {
    borderWidth: 1,
    borderColor: colors.borderInput,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    minHeight: 56,
    textAlignVertical: 'top',
    backgroundColor: '#fff',
  },
  snoozeRow: { flexDirection: 'row', gap: 10 },
  userRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  userChip: { borderWidth: 1, borderColor: colors.borderInput, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  userChipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  userChipText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  userChipTextActive: { color: '#fff' },
});
