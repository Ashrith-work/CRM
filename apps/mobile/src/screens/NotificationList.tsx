import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import type { Notification, NotificationListResponse } from '@crm/types';
import { colors, ErrorBox, Loading } from '../ui';
import { useAuthedLoad } from '../useAuthedLoad';
import { useNav } from '../navigation';
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '../api';
import { ScreenHeader } from './ScreenHeader';

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function NotificationList(): React.JSX.Element {
  const { getToken } = useAuth();
  const { push } = useNav();
  const { state, reload } = useAuthedLoad<NotificationListResponse>((t) => listNotifications(t, { limit: 50 }), []);
  const [busy, setBusy] = useState(false);

  const open = async (n: Notification) => {
    try {
      if (!n.readAt) await markNotificationRead(getToken, n.id);
      if (n.taskId) push({ name: 'taskDetail', id: n.taskId });
      else await reload();
    } catch {
      // best-effort — a failed mark-read shouldn't block navigation
      if (n.taskId) push({ name: 'taskDetail', id: n.taskId });
    }
  };

  const markAll = async () => {
    setBusy(true);
    try {
      await markAllNotificationsRead(getToken);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ScreenHeader
        title="Notifications"
        right={
          <TouchableOpacity onPress={() => void markAll()} disabled={busy} hitSlop={8}>
            <Text style={styles.markAll}>Mark all read</Text>
          </TouchableOpacity>
        }
      />
      {state.status === 'loading' ? <Loading /> : null}
      {state.status === 'error' ? <ErrorBox message={state.message} onRetry={() => void reload()} /> : null}
      {state.status === 'ready' ? (
        state.data.data.length === 0 ? (
          <Text style={styles.empty}>No notifications.</Text>
        ) : (
          <View style={{ gap: 8 }}>
            {state.data.data.map((n) => (
              <TouchableOpacity key={n.id} style={[styles.row, !n.readAt && styles.unread]} onPress={() => void open(n)}>
                {!n.readAt ? <View style={styles.dot} /> : <View style={styles.dotSpacer} />}
                <View style={{ flexShrink: 1 }}>
                  <Text style={[styles.title, !n.readAt && styles.titleUnread]}>{n.title}</Text>
                  <Text style={styles.body}>{n.body}</Text>
                  <Text style={styles.meta}>{when(n.createdAt)}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 64, backgroundColor: colors.bg, minHeight: '100%' },
  markAll: { color: colors.brand, fontWeight: '600', fontSize: 14 },
  empty: { color: colors.muted, marginTop: 16 },
  row: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  unread: { borderColor: colors.brand, backgroundColor: '#eef2ff' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand, marginTop: 6 },
  dotSpacer: { width: 8 },
  title: { fontSize: 15, fontWeight: '600', color: colors.text },
  titleUnread: { fontWeight: '700' },
  body: { color: colors.text, marginTop: 2 },
  meta: { color: colors.muted, fontSize: 12, marginTop: 4 },
});
