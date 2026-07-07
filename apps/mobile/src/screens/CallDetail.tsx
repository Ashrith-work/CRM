import { useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import type { Call } from '@crm/types';
import { Card, colors, ErrorBox, Loading, Pill, PrimaryButton, Row, SecondaryButton } from '../ui';
import { useAuthedLoad } from '../useAuthedLoad';
import { useNav } from '../navigation';
import { formatDuration, getCall, getCallRecording, updateCall, type TokenGetter } from '../api';
import { ScreenHeader } from './ScreenHeader';
import { CALL_STATUS_COLOR, CONSENT_COLOR, CONSENT_LABEL, directionArrow } from './callShared';

export function CallDetail({ id }: { id: string }): React.JSX.Element {
  const { getToken } = useAuth();
  const { push } = useNav();
  const [refresh, setRefresh] = useState(0);
  const { state, reload } = useAuthedLoad<Call>((t) => getCall(t, id), [id, refresh]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [disposition, setDisposition] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);

  const run = async (fn: (getToken: TokenGetter) => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn(getToken);
      await reload();
      setRefresh((n) => n + 1);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const play = async () => {
    try {
      const res = await getCallRecording(getToken, id);
      if (res.url) await Linking.openURL(res.url);
      else Alert.alert('Recording unavailable', res.reason ?? 'This recording cannot be played.');
    } catch (err) {
      Alert.alert('Recording unavailable', (err as Error).message);
    }
  };

  const Frame = ({ children }: { children: React.ReactNode }) => (
    <ScrollView contentContainerStyle={styles.container}>
      <ScreenHeader title="Call" />
      <View style={{ gap: 12 }}>{children}</View>
    </ScrollView>
  );

  if (state.status === 'loading') return <Frame><Loading /></Frame>;
  if (state.status === 'error') return <Frame><ErrorBox message={state.message} onRetry={() => void reload()} /></Frame>;
  const c = state.data;
  const dispositionValue = disposition ?? c.disposition ?? '';
  const notesValue = notes ?? c.notes ?? '';

  return (
    <Frame>
      <Card title="Call">
        <View style={styles.titleLine}>
          <Text style={styles.arrow}>{directionArrow(c.direction)}</Text>
          <Text style={styles.dir}>{c.direction === 'INBOUND' ? 'Inbound' : 'Outbound'}</Text>
          <Pill label={c.status} color={CALL_STATUS_COLOR[c.status]} />
        </View>
        <Row label="From" value={c.fromNumber} />
        <Row label="To" value={c.toNumber} />
        <Row label="Started" value={c.startedAt ? new Date(c.startedAt).toLocaleString() : '—'} />
        <Row label="Duration" value={formatDuration(c.durationSeconds)} />
        <Row label="Agent" value={c.agent ? [c.agent.firstName, c.agent.lastName].filter(Boolean).join(' ') || c.agent.email : '—'} />
      </Card>

      {c.contact ? (
        <Card title="Contact">
          <TouchableOpacity onPress={() => push({ name: 'detail', entity: 'CONTACT', id: c.contact!.id })}>
            <Row label="Name" value={`${c.contact.firstName} ${c.contact.lastName} ›`} />
          </TouchableOpacity>
          {c.contact.phone ? <Row label="Phone" value={c.contact.phone} /> : null}
          {c.ambiguousMatch ? <Text style={styles.warn}>This number matched multiple contacts — showing the most recent.</Text> : null}
        </Card>
      ) : null}

      <Card title="Recording">
        {c.consentStatus ? (
          <View style={{ marginBottom: 8 }}>
            <Pill label={CONSENT_LABEL[c.consentStatus]} color={CONSENT_COLOR[c.consentStatus]} />
          </View>
        ) : null}
        {c.recordingStatus === 'STORED' ? (
          <PrimaryButton title="▶ Play recording" onPress={() => void play()} />
        ) : (
          <Text style={styles.muted}>
            {c.recordingStatus === 'BLOCKED'
              ? 'Blocked — no recording consent.'
              : c.recordingStatus === 'PENDING'
                ? 'Recording is being fetched…'
                : c.recordingStatus === 'FAILED'
                  ? 'Recording fetch failed.'
                  : 'No recording for this call.'}
          </Text>
        )}
      </Card>

      <Card title="Outcome">
        <Text style={styles.label}>Disposition</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Interested, Callback requested"
          value={dispositionValue}
          onChangeText={setDisposition}
        />
        <Text style={[styles.label, { marginTop: 10 }]}>Notes</Text>
        <TextInput
          style={[styles.input, styles.notes]}
          placeholder="Add notes…"
          value={notesValue}
          onChangeText={setNotes}
          multiline
        />
        <View style={{ marginTop: 10 }}>
          <PrimaryButton
            title="Save outcome"
            busy={busy}
            onPress={() => void run((t) => updateCall(t, id, { disposition: dispositionValue || null, notes: notesValue || null }))}
          />
        </View>
      </Card>

      {c.deal ? (
        <Card title="Deal">
          <TouchableOpacity onPress={() => push({ name: 'dealDetail', id: c.deal!.id })}>
            <Row label="Linked deal" value={`${c.deal.name} ›`} />
          </TouchableOpacity>
        </Card>
      ) : null}

      {actionError ? <ErrorBox message={actionError} /> : null}
      <SecondaryButton title="Refresh" onPress={() => void reload()} />
    </Frame>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 64, backgroundColor: colors.bg, minHeight: '100%' },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  arrow: { fontSize: 20, color: colors.muted },
  dir: { fontSize: 16, fontWeight: '700', color: colors.text, flex: 1 },
  muted: { color: colors.muted },
  warn: { color: '#d97706', fontSize: 13, marginTop: 6 },
  label: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: colors.borderInput,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    backgroundColor: '#fff',
    marginTop: 4,
  },
  notes: { minHeight: 70, textAlignVertical: 'top' },
});
