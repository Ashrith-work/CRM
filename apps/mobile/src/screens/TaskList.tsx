import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { AgendaResponse, Task } from '@crm/types';
import { colors, ErrorBox, Loading, Pill } from '../ui';
import { useAuthedLoad } from '../useAuthedLoad';
import { useNav } from '../navigation';
import { getAgenda } from '../api';
import { ScreenHeader } from './ScreenHeader';
import { formatWhen, PRIORITY_COLOR, taskAnchorIso, TYPE_LABEL } from './taskShared';

/** "Today + overdue" list (with an Upcoming toggle) built from the agenda. */
export function TaskList(): React.JSX.Element {
  const { push } = useNav();
  const [showUpcoming, setShowUpcoming] = useState(false);
  const { state, reload } = useAuthedLoad<AgendaResponse>((t) => getAgenda(t, { assigneeId: 'me' }), []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ScreenHeader
        title="My Tasks"
        right={
          <TouchableOpacity onPress={() => push({ name: 'quickAddTask' })} hitSlop={8}>
            <Text style={styles.add}>＋ New</Text>
          </TouchableOpacity>
        }
      />

      {state.status === 'loading' ? <Loading /> : null}
      {state.status === 'error' ? <ErrorBox message={state.message} onRetry={() => void reload()} /> : null}
      {state.status === 'ready' ? (
        <View style={{ gap: 16 }}>
          <Section
            title="Overdue"
            tasks={state.data.overdue}
            overdue
            onOpen={(id) => push({ name: 'taskDetail', id })}
          />
          <Section
            title="Today"
            tasks={state.data.today}
            onOpen={(id) => push({ name: 'taskDetail', id })}
          />

          <TouchableOpacity style={styles.toggle} onPress={() => setShowUpcoming((v) => !v)}>
            <Text style={styles.toggleText}>
              {showUpcoming ? 'Hide upcoming' : `Show upcoming (${state.data.upcoming.length})`}
            </Text>
          </TouchableOpacity>
          {showUpcoming ? (
            <Section
              title="Upcoming"
              tasks={state.data.upcoming}
              onOpen={(id) => push({ name: 'taskDetail', id })}
            />
          ) : null}

          <Text style={styles.tz}>Times in {state.data.timezone}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

function Section({
  title,
  tasks,
  overdue,
  onOpen,
}: {
  title: string;
  tasks: Task[];
  overdue?: boolean;
  onOpen: (id: string) => void;
}): React.JSX.Element {
  return (
    <View style={{ gap: 8 }}>
      <Text style={[styles.sectionTitle, overdue && tasks.length > 0 ? styles.overdueTitle : null]}>
        {title} ({tasks.length})
      </Text>
      {tasks.length === 0 ? (
        <Text style={styles.empty}>Nothing here.</Text>
      ) : (
        tasks.map((t) => <TaskRow key={t.id} task={t} overdue={overdue} onOpen={onOpen} />)
      )}
    </View>
  );
}

export function TaskRow({
  task,
  overdue,
  onOpen,
}: {
  task: Task;
  overdue?: boolean;
  onOpen: (id: string) => void;
}): React.JSX.Element {
  return (
    <TouchableOpacity style={styles.row} onPress={() => onOpen(task.id)}>
      <View style={{ flexShrink: 1, gap: 2 }}>
        <Text style={styles.rowTitle}>{task.title}</Text>
        <Text style={[styles.rowMeta, overdue ? styles.overdueText : null]}>
          {TYPE_LABEL[task.type]} · {formatWhen(taskAnchorIso(task))}
          {task.related ? ` · ${task.related.label}` : ''}
        </Text>
      </View>
      <Pill label={task.priority} color={PRIORITY_COLOR[task.priority]} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 64, backgroundColor: colors.bg, minHeight: '100%' },
  add: { color: colors.brand, fontWeight: '700', fontSize: 15 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase' },
  overdueTitle: { color: '#dc2626' },
  overdueText: { color: '#dc2626' },
  empty: { color: colors.muted },
  toggle: { alignSelf: 'flex-start' },
  toggleText: { color: colors.brand, fontWeight: '600' },
  tz: { color: colors.muted, fontSize: 12, marginTop: 4 },
  row: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  rowTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  rowMeta: { color: colors.muted, fontSize: 13 },
});
