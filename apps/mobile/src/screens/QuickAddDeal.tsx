import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import type { Contact, Pipeline } from '@crm/types';
import { colors, ErrorBox, LabeledInput, Loading, PrimaryButton } from '../ui';
import { useAuthedLoad } from '../useAuthedLoad';
import { useNav } from '../navigation';
import { createDeal, listContacts, listPipelines, parseAmountToMinor } from '../api';
import { ScreenHeader } from './ScreenHeader';

/** Minimal create form for a deal: name, pipeline, amount, optional contact. */
export function QuickAddDeal(): React.JSX.Element {
  const { state, reload } = useAuthedLoad<{ pipelines: Pipeline[]; contacts: Contact[] }>(
    async (t) => {
      const [pipelines, contacts] = await Promise.all([listPipelines(t), listContacts(t, { limit: 15 })]);
      return { pipelines: pipelines.data, contacts: contacts.data };
    },
    [],
  );

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container}>
        <ScreenHeader title="New deal" />
        {state.status === 'loading' ? <Loading /> : null}
        {state.status === 'error' ? <ErrorBox message={state.message} onRetry={() => void reload()} /> : null}
        {state.status === 'ready' ? <Form pipelines={state.data.pipelines} contacts={state.data.contacts} /> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Form({ pipelines, contacts }: { pipelines: Pipeline[]; contacts: Contact[] }): React.JSX.Element {
  const { getToken } = useAuth();
  const { pop } = useNav();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [pipelineId, setPipelineId] = useState(
    (pipelines.find((p) => p.isDefault) ?? pipelines[0])?.id ?? '',
  );
  const [contactId, setContactId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await createDeal(getToken, {
        name: name.trim(),
        pipelineId,
        amountMinor: amount.trim() ? parseAmountToMinor(amount) : 0,
        currency: 'USD',
        contactId: contactId ?? undefined,
      });
      pop();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (pipelines.length === 0) {
    return <ErrorBox message="No pipeline configured. Create one on the web app first." />;
  }

  return (
    <View style={{ gap: 12 }}>
      <LabeledInput label="Deal name" value={name} onChangeText={setName} autoCapitalize="sentences" />
      <LabeledInput label="Amount" value={amount} onChangeText={setAmount} placeholder="0.00" />

      <Text style={styles.label}>Pipeline</Text>
      <View style={styles.chipRow}>
        {pipelines.map((p) => (
          <Chip key={p.id} label={p.name} active={p.id === pipelineId} onPress={() => setPipelineId(p.id)} />
        ))}
      </View>

      {contacts.length > 0 ? (
        <>
          <Text style={styles.label}>Contact (optional)</Text>
          <View style={styles.chipRow}>
            <Chip label="None" active={contactId === null} onPress={() => setContactId(null)} />
            {contacts.map((c) => (
              <Chip
                key={c.id}
                label={`${c.firstName} ${c.lastName}`.trim()}
                active={contactId === c.id}
                onPress={() => setContactId(c.id)}
              />
            ))}
          </View>
        </>
      ) : null}

      {error ? <ErrorBox message={error} /> : null}
      <View style={{ marginTop: 8 }}>
        <PrimaryButton title="Save" busy={busy} disabled={!name.trim() || !pipelineId} onPress={() => void submit()} />
      </View>
      <Text style={styles.hint}>A deal lands in the pipeline’s first stage.</Text>
    </View>
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
  label: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.borderInput, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  chipTextActive: { color: '#fff' },
  hint: { color: colors.muted, fontSize: 13 },
});
