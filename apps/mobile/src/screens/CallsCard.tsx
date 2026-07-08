import { useState } from 'react';
import { Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import type { Call, Consent } from '@crm/types';
import { Card, colors, ErrorBox, Loading, Pill, PrimaryButton, SecondaryButton } from '../ui';
import { useAuthedLoad } from '../useAuthedLoad';
import { useNav } from '../navigation';
import { clickToCall, listCalls, listConsents, setConsent, type TokenGetter } from '../api';
import { CallRow } from './CallHistory';
import { CONSENT_COLOR } from './callShared';

/** Contact-detail "Calls" card: click-to-call, DPDP consent, recent calls. */
export function CallsCard({
  contactId,
  contactName,
  contactPhone,
}: {
  contactId: string;
  contactName: string;
  contactPhone: string | null;
}): React.JSX.Element {
  const { getToken } = useAuth();
  const { push } = useNav();
  const [refresh, setRefresh] = useState(0);
  const bump = () => setRefresh((n) => n + 1);
  const { state, reload } = useAuthedLoad<{ calls: Call[]; consent: Consent | null }>(
    async (t) => {
      const [calls, consents] = await Promise.all([
        listCalls(t, { contactId, limit: 10 }),
        listConsents(t, contactId),
      ]);
      return { calls: calls.data, consent: consents.data.find((c) => c.purpose === 'CALL_RECORDING') ?? null };
    },
    [contactId, refresh],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: (getToken: TokenGetter) => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn(getToken);
      await reload();
      bump();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const call = () =>
    void run(async (t) => {
      await clickToCall(t, { contactId });
      Alert.alert('Dialing…', 'MyOperator is connecting your call. It will be logged automatically.');
    });

  const withdraw = () =>
    Alert.alert('Withdraw consent?', 'This stops new recordings and purges any stored recordings for this contact (DPDP erasure).', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Withdraw', style: 'destructive', onPress: () => void run((t) => setConsent(t, { contactId, purpose: 'CALL_RECORDING', status: 'WITHDRAWN' })) },
    ]);

  const consentStatus = state.status === 'ready' ? state.data.consent?.status ?? 'NOT_CAPTURED' : 'NOT_CAPTURED';

  return (
    <Card title="Calls">
      <View style={styles.actions}>
        <PrimaryButton title="📞 Call" busy={busy} onPress={call} />
        {contactPhone ? <SecondaryButton title="Dial (native)" onPress={() => void Linking.openURL(`tel:${contactPhone}`)} /> : null}
      </View>
      <View style={styles.logRow}>
        <TouchableOpacity onPress={() => push({ name: 'logCall', contactId, contactName })}>
          <Text style={styles.link}>＋ Log a call</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.consentRow}>
        <Pill label={`Consent: ${consentStatus.replace('_', ' ').toLowerCase()}`} color={CONSENT_COLOR[consentStatus]} />
        {consentStatus === 'GRANTED' ? (
          <TouchableOpacity onPress={withdraw} disabled={busy}><Text style={styles.withdraw}>Withdraw</Text></TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={() => void run((t) => setConsent(t, { contactId, purpose: 'CALL_RECORDING', status: 'GRANTED', source: 'EXPLICIT' }))} disabled={busy}>
            <Text style={styles.grant}>Grant recording consent</Text>
          </TouchableOpacity>
        )}
      </View>

      {error ? <ErrorBox message={error} /> : null}

      <View style={{ marginTop: 10, gap: 8 }}>
        {state.status === 'loading' && <Loading />}
        {state.status === 'error' && <ErrorBox message={state.message} onRetry={() => void reload()} />}
        {state.status === 'ready' && state.data.calls.length === 0 && <Text style={styles.muted}>No calls yet.</Text>}
        {state.status === 'ready' &&
          state.data.calls.map((c) => <CallRow key={c.id} call={c} onPress={() => push({ name: 'callDetail', id: c.id })} />)}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  logRow: { marginTop: 10 },
  link: { color: colors.brand, fontWeight: '600' },
  consentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, gap: 8, flexWrap: 'wrap' },
  withdraw: { color: colors.danger, fontWeight: '600' },
  grant: { color: colors.brand, fontWeight: '600' },
  muted: { color: colors.muted },
});
