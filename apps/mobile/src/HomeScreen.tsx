import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import type { MeResponse } from '@crm/types';
import { fetchMe } from './api';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; me: MeResponse };

/** The single authenticated screen: calls /api/v1/me and shows the result. */
export function HomeScreen() {
  const { getToken, signOut } = useAuth();
  const [state, setState] = useState<State>({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const token = await getToken();
      if (!token) throw new Error('No session token');
      const me = await fetchMe(token);
      setState({ status: 'ready', me });
    } catch (err) {
      setState({ status: 'error', message: (err as Error).message });
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Dashboard</Text>
        <TouchableOpacity onPress={() => signOut()}>
          <Text style={styles.signOut}>Sign out</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.caption}>From GET /api/v1/me</Text>

      {state.status === 'loading' && <ActivityIndicator style={{ marginTop: 24 }} />}

      {state.status === 'error' && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{state.message}</Text>
          <TouchableOpacity style={styles.retry} onPress={() => void load()}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {state.status === 'ready' && (
        <View style={{ gap: 12, marginTop: 12 }}>
          <Card title="User">
            <Row label="Email" value={state.me.user.email} />
            <Row
              label="Name"
              value={
                [state.me.user.firstName, state.me.user.lastName].filter(Boolean).join(' ') || '—'
              }
            />
          </Card>
          <Card title="Organization">
            <Row label="Name" value={state.me.organization.name} />
            <Row label="Slug" value={state.me.organization.slug} />
          </Card>
          <Card title="Team">
            <Row label="Name" value={state.me.team?.name ?? 'No team'} />
          </Card>
          <Card title="Role">
            <Row label="Role" value={state.me.role.name} />
            <Row label="Permissions" value={state.me.role.permissions.join(', ')} />
          </Card>
        </View>
      )}
    </ScrollView>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 64, backgroundColor: '#f8fafc', minHeight: '100%' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 26, fontWeight: '700' },
  signOut: { color: '#274fd6', fontWeight: '600' },
  caption: { color: '#64748b', marginTop: 2 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#e2e8f0' },
  cardTitle: { fontSize: 12, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, gap: 12 },
  rowLabel: { color: '#64748b' },
  rowValue: { fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  errorBox: { backgroundColor: '#fef2f2', borderColor: '#fecaca', borderWidth: 1, borderRadius: 12, padding: 16, marginTop: 16 },
  errorText: { color: '#b91c1c' },
  retry: { backgroundColor: '#dc2626', borderRadius: 8, padding: 10, alignItems: 'center', marginTop: 10 },
  retryText: { color: '#fff', fontWeight: '600' },
});
