import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import { colors } from '../ui';
import { useNav } from '../navigation';
import { useAuthedLoad } from '../useAuthedLoad';
import { fetchMe, getUnreadCount } from '../api';
import { ScreenHeader } from './ScreenHeader';

/** Signed-in landing: greeting from /me + entity navigation. */
export function HomeMenu(): React.JSX.Element {
  const { signOut } = useAuth();
  const { push } = useNav();
  const { state } = useAuthedLoad((t) => fetchMe(t), []);
  const { state: unread } = useAuthedLoad((t) => getUnreadCount(t), []);
  const unreadCount = unread.status === 'ready' ? unread.data.count : 0;

  const greeting =
    state.status === 'ready'
      ? [state.data.user.firstName, state.data.user.lastName].filter(Boolean).join(' ') ||
        state.data.user.email
      : '…';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ScreenHeader
        title="CRM"
        right={
          <TouchableOpacity onPress={() => signOut()} hitSlop={8}>
            <Text style={styles.signOut}>Sign out</Text>
          </TouchableOpacity>
        }
      />
      <Text style={styles.caption}>
        Signed in as {greeting}
        {state.status === 'ready' ? ` · ${state.data.organization.name}` : ''}
      </Text>

      <View style={{ gap: 12, marginTop: 16 }}>
        <MenuItem label="My Tasks" subtitle="Today & overdue" onPress={() => push({ name: 'taskList' })} />
        <MenuItem label="Agenda" subtitle="Your day, upcoming" onPress={() => push({ name: 'agenda' })} />
        <MenuItem
          label="Notifications"
          subtitle="Reminders & assignments"
          badge={unreadCount > 0 ? unreadCount : undefined}
          onPress={() => push({ name: 'notifications' })}
        />
        <MenuItem label="My performance" subtitle="Your sales metrics" onPress={() => push({ name: 'performance' })} />
        <MenuItem label="Pipeline" subtitle="Deals by stage" onPress={() => push({ name: 'pipeline' })} />
        <MenuItem label="Contacts" subtitle="Browse & add people" onPress={() => push({ name: 'list', entity: 'CONTACT' })} />
        <MenuItem label="Companies" subtitle="Browse organizations" onPress={() => push({ name: 'list', entity: 'COMPANY' })} />
        <MenuItem label="Leads" subtitle="Qualify & convert" onPress={() => push({ name: 'list', entity: 'LEAD' })} />
      </View>
    </ScrollView>
  );
}

function MenuItem({
  label,
  subtitle,
  onPress,
  badge,
}: {
  label: string;
  subtitle: string;
  onPress: () => void;
  badge?: number;
}): React.JSX.Element {
  return (
    <TouchableOpacity style={styles.item} onPress={onPress}>
      <View>
        <Text style={styles.itemLabel}>{label}</Text>
        <Text style={styles.itemSubtitle}>{subtitle}</Text>
      </View>
      <View style={styles.itemRight}>
        {badge !== undefined ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
          </View>
        ) : null}
        <Text style={styles.chevron}>›</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 64, backgroundColor: colors.bg, minHeight: '100%' },
  signOut: { color: colors.brand, fontWeight: '600' },
  caption: { color: colors.muted },
  item: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemLabel: { fontSize: 17, fontWeight: '700', color: colors.text },
  itemSubtitle: { color: colors.muted, marginTop: 2 },
  itemRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chevron: { fontSize: 24, color: colors.muted },
  badge: { backgroundColor: colors.danger, borderRadius: 999, minWidth: 22, paddingHorizontal: 6, paddingVertical: 2, alignItems: 'center' },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
