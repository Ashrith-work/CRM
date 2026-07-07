import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { Call } from '@crm/types';
import { Card, colors, ErrorBox, Loading, Pill } from '../ui';
import { useAuthedLoad } from '../useAuthedLoad';
import { useNav } from '../navigation';
import { formatDuration, listCalls } from '../api';
import { ScreenHeader } from './ScreenHeader';
import { CALL_STATUS_COLOR, directionArrow } from './callShared';

/** "My recent calls" — the calls placed/received by the current agent. */
export function CallHistory(): React.JSX.Element {
  const { push } = useNav();
  const { state, reload } = useAuthedLoad((t) => listCalls(t, { agentUserId: 'me', limit: 50 }), []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ScreenHeader
        title="Calls"
        right={
          <TouchableOpacity onPress={() => push({ name: 'logCall' })} hitSlop={8}>
            <Text style={styles.add}>＋ Log call</Text>
          </TouchableOpacity>
        }
      />
      {state.status === 'loading' && <Loading />}
      {state.status === 'error' && <ErrorBox message={state.message} onRetry={() => void reload()} />}
      {state.status === 'ready' && state.data.data.length === 0 && (
        <Card><Text style={styles.muted}>No calls yet. Tap “＋ Log call” or call a contact.</Text></Card>
      )}
      {state.status === 'ready' && (
        <View style={{ gap: 10 }}>
          {state.data.data.map((c) => (
            <CallRow key={c.id} call={c} onPress={() => push({ name: 'callDetail', id: c.id })} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

/** A compact call row, reused on the contact detail's Calls card. */
export function CallRow({ call, onPress }: { call: Call; onPress: () => void }): React.JSX.Element {
  const who = call.contact ? `${call.contact.firstName} ${call.contact.lastName}` : call.direction === 'INBOUND' ? call.fromNumber : call.toNumber;
  const started = call.startedAt ? new Date(call.startedAt).toLocaleString() : '—';
  return (
    <TouchableOpacity style={styles.row} onPress={onPress}>
      <Text style={styles.arrow}>{directionArrow(call.direction)}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.who} numberOfLines={1}>{who}</Text>
        <Text style={styles.meta}>{started} · {formatDuration(call.durationSeconds)}</Text>
      </View>
      <View style={styles.right}>
        {call.recordingAvailable ? <Text style={styles.rec}>▶</Text> : null}
        <Pill label={call.status} color={CALL_STATUS_COLOR[call.status]} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 64, backgroundColor: colors.bg, minHeight: '100%' },
  add: { color: colors.brand, fontWeight: '700', fontSize: 15 },
  muted: { color: colors.muted },
  row: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  arrow: { fontSize: 18, color: colors.muted, width: 18, textAlign: 'center' },
  who: { fontSize: 15, fontWeight: '700', color: colors.text },
  meta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rec: { color: colors.brand, fontSize: 14 },
});
