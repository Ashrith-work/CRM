import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { AgendaResponse, Task } from '@crm/types';
import { colors, ErrorBox, Loading } from '../ui';
import { useAuthedLoad } from '../useAuthedLoad';
import { useNav } from '../navigation';
import { getAgenda } from '../api';
import { ScreenHeader } from './ScreenHeader';
import { TaskRow } from './TaskList';

/** Day/agenda view: Overdue → Today → Upcoming, in the assignee's timezone. */
export function Agenda(): React.JSX.Element {
  const { push } = useNav();
  const { state, reload } = useAuthedLoad<AgendaResponse>((t) => getAgenda(t, { assigneeId: 'me' }), []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ScreenHeader title="Agenda" />
      {state.status === 'loading' ? <Loading /> : null}
      {state.status === 'error' ? <ErrorBox message={state.message} onRetry={() => void reload()} /> : null}
      {state.status === 'ready' ? (
        <View style={{ gap: 18 }}>
          <Group title="Overdue" tasks={state.data.overdue} overdue onOpen={(id) => push({ name: 'taskDetail', id })} />
          <Group title="Today" tasks={state.data.today} onOpen={(id) => push({ name: 'taskDetail', id })} />
          <Group title="Upcoming" tasks={state.data.upcoming} onOpen={(id) => push({ name: 'taskDetail', id })} />
          <Text style={styles.tz}>Times in {state.data.timezone}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

function Group({
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
      <Text style={[styles.title, overdue && tasks.length > 0 ? styles.overdue : null]}>
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

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 64, backgroundColor: colors.bg, minHeight: '100%' },
  title: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase' },
  overdue: { color: '#dc2626' },
  empty: { color: colors.muted },
  tz: { color: colors.muted, fontSize: 12 },
});
