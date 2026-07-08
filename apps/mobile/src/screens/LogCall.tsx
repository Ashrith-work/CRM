import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import type { CallDirection, CallStatus, LogCallInput } from '@crm/types';
import { colors, ErrorBox, LabeledInput, PrimaryButton } from '../ui';
import { useNav } from '../navigation';
import { logCall } from '../api';
import { ScreenHeader } from './ScreenHeader';

const STATUSES: CallStatus[] = ['COMPLETED', 'MISSED', 'NO_ANSWER', 'FAILED'];

/** Manually log a call that happened outside click-to-call. */
export function LogCall({ contactId, contactName }: { contactId?: string; contactName?: string }): React.JSX.Element {
  const { getToken } = useAuth();
  const { pop } = useNav();
  const [direction, setDirection] = useState<CallDirection>('OUTBOUND');
  const [status, setStatus] = useState<CallStatus>('COMPLETED');
  const [number, setNumber] = useState('');
  const [durationMin, setDurationMin] = useState('');
  const [disposition, setDisposition] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const minutes = Number(durationMin);
      const body: LogCallInput = {
        direction,
        status,
        ...(contactId ? { contactId } : {}),
        ...(number.trim() ? (direction === 'INBOUND' ? { fromNumber: number.trim() } : { toNumber: number.trim() }) : {}),
        ...(Number.isFinite(minutes) && minutes > 0 ? { durationSeconds: Math.round(minutes * 60) } : {}),
        ...(disposition.trim() ? { disposition: disposition.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };
      await logCall(getToken, body);
      pop();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = !!contactId || number.trim().length > 0;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container}>
        <ScreenHeader title="Log a call" />
        <View style={{ gap: 12 }}>
          {contactName ? <Text style={styles.linked}>With {contactName}.</Text> : null}

          <Text style={styles.label}>Direction</Text>
          <View style={styles.chipRow}>
            <Chip label="↗ Outbound" active={direction === 'OUTBOUND'} onPress={() => setDirection('OUTBOUND')} />
            <Chip label="↙ Inbound" active={direction === 'INBOUND'} onPress={() => setDirection('INBOUND')} />
          </View>

          {!contactId ? (
            <LabeledInput label="Phone number" value={number} onChangeText={setNumber} placeholder="+91…" keyboardType="phone-pad" />
          ) : null}

          <Text style={styles.label}>Outcome</Text>
          <View style={styles.chipRow}>
            {STATUSES.map((s) => (
              <Chip key={s} label={s.replace('_', ' ')} active={s === status} onPress={() => setStatus(s)} />
            ))}
          </View>

          <LabeledInput label="Duration (minutes, optional)" value={durationMin} onChangeText={setDurationMin} placeholder="e.g. 3" keyboardType="phone-pad" />
          <LabeledInput label="Disposition (optional)" value={disposition} onChangeText={setDisposition} placeholder="e.g. Interested" autoCapitalize="sentences" />
          <LabeledInput label="Notes (optional)" value={notes} onChangeText={setNotes} autoCapitalize="sentences" />

          {error ? <ErrorBox message={error} /> : null}
          <View style={{ marginTop: 8 }}>
            <PrimaryButton title="Save call" busy={busy} disabled={!canSubmit} onPress={() => void submit()} />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }): React.JSX.Element {
  return (
    <TouchableOpacity style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 64, backgroundColor: colors.bg, minHeight: '100%' },
  linked: { color: colors.muted },
  label: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.borderInput, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  chipTextActive: { color: '#fff' },
});
