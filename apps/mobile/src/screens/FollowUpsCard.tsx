import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { EntityType, TaskListResponse } from '@crm/types';
import { Card, colors, Loading } from '../ui';
import { useAuthedLoad } from '../useAuthedLoad';
import { useNav } from '../navigation';
import { listTasks } from '../api';
import { formatWhen, taskAnchorIso, TYPE_LABEL } from './taskShared';

/**
 * Open tasks/follow-ups linked to a CRM record, with a "Schedule follow-up"
 * action. Embedded on the contact/company/lead/deal detail screens.
 */
export function FollowUpsCard({
  relatedType,
  relatedId,
  refreshToken,
}: {
  relatedType: EntityType;
  relatedId: string;
  refreshToken?: number;
}): React.JSX.Element {
  const { push } = useNav();
  const { state } = useAuthedLoad<TaskListResponse>(
    (t) => listTasks(t, { relatedType, relatedId, status: 'OPEN', limit: 20 }),
    [relatedType, relatedId, refreshToken],
  );

  return (
    <Card title="Follow-ups & tasks">
      {state.status === 'loading' ? <Loading /> : null}
      {state.status === 'error' ? <Text style={styles.error}>{state.message}</Text> : null}
      {state.status === 'ready' ? (
        state.data.data.length === 0 ? (
          <Text style={styles.muted}>No open tasks.</Text>
        ) : (
          <View style={{ gap: 8 }}>
            {state.data.data.map((t) => (
              <TouchableOpacity key={t.id} style={styles.row} onPress={() => push({ name: 'taskDetail', id: t.id })}>
                <Text style={styles.rowTitle}>{t.title}</Text>
                <Text style={styles.rowMeta}>
                  {TYPE_LABEL[t.type]} · {formatWhen(taskAnchorIso(t))}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )
      ) : null}
      <TouchableOpacity
        style={styles.add}
        onPress={() => push({ name: 'quickAddTask', relatedType, relatedId })}
      >
        <Text style={styles.addText}>＋ Schedule follow-up</Text>
      </TouchableOpacity>
    </Card>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.danger },
  muted: { color: colors.muted },
  row: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: '500' },
  rowMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  add: { marginTop: 12 },
  addText: { color: colors.brand, fontWeight: '700' },
});
