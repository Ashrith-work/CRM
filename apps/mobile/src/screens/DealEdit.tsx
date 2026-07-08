import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import type { Deal } from '@crm/types';
import { colors, ErrorBox, LabeledInput, Loading, PrimaryButton } from '../ui';
import { useAuthedLoad } from '../useAuthedLoad';
import { useNav } from '../navigation';
import { getDeal, parseAmountToMinor, updateDeal } from '../api';
import { ScreenHeader } from './ScreenHeader';

/** Edit a deal's core fields (name, amount, expected close date). */
export function DealEdit({ id }: { id: string }): React.JSX.Element {
  const { state, reload } = useAuthedLoad((t) => getDeal(t, id), [id]);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container}>
        <ScreenHeader title="Edit deal" />
        {state.status === 'loading' ? <Loading /> : null}
        {state.status === 'error' ? <ErrorBox message={state.message} onRetry={() => void reload()} /> : null}
        {state.status === 'ready' ? <EditForm deal={state.data} /> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function EditForm({ deal }: { deal: Deal }): React.JSX.Element {
  const { getToken } = useAuth();
  const { pop } = useNav();
  const [name, setName] = useState(deal.name);
  const [amount, setAmount] = useState((deal.amountMinor / 100).toString());
  const [closeDate, setCloseDate] = useState(deal.expectedCloseDate ? deal.expectedCloseDate.slice(0, 10) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateDeal(getToken, deal.id, {
        name: name.trim(),
        amountMinor: parseAmountToMinor(amount),
        expectedCloseDate: closeDate.trim() ? closeDate.trim() : null,
      });
      pop();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 12 }}>
      <LabeledInput label="Name" value={name} onChangeText={setName} autoCapitalize="sentences" />
      <LabeledInput label={`Amount (${deal.currency})`} value={amount} onChangeText={setAmount} keyboardType="default" />
      <LabeledInput label="Expected close date (YYYY-MM-DD)" value={closeDate} onChangeText={setCloseDate} autoCapitalize="none" />
      {error ? <ErrorBox message={error} /> : null}
      <View style={{ marginTop: 8 }}>
        <PrimaryButton title="Save" busy={busy} disabled={!name.trim()} onPress={() => void submit()} />
      </View>
      <Text style={styles.hint}>Amount is stored as integer minor units on the server.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 64, backgroundColor: colors.bg, minHeight: '100%' },
  hint: { color: colors.muted, fontSize: 13 },
});
