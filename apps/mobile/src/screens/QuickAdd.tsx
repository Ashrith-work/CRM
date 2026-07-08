import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import { colors, ErrorBox, LabeledInput, PrimaryButton } from '../ui';
import { useNav } from '../navigation';
import { createContact, createLead } from '../api';
import { ScreenHeader } from './ScreenHeader';

/** Minimal create form for a contact. */
export function QuickAddContact(): React.JSX.Element {
  const { getToken } = useAuth();
  const { pop } = useNav();
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await createContact(getToken, {
        firstName: first.trim(),
        lastName: last.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      pop();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Form title="New contact" busy={busy} error={error} canSubmit={!!first.trim() && !!last.trim()} onSubmit={submit}>
      <LabeledInput label="First name" value={first} onChangeText={setFirst} autoCapitalize="words" />
      <LabeledInput label="Last name" value={last} onChangeText={setLast} autoCapitalize="words" />
      <LabeledInput label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      <LabeledInput label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
    </Form>
  );
}

/** Minimal create form for a lead. */
export function QuickAddLead(): React.JSX.Element {
  const { getToken } = useAuth();
  const { pop } = useNav();
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await createLead(getToken, {
        firstName: first.trim(),
        lastName: last.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        source: source.trim() || undefined,
      });
      pop();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Form title="New lead" busy={busy} error={error} canSubmit={!!first.trim() && !!last.trim()} onSubmit={submit}>
      <LabeledInput label="First name" value={first} onChangeText={setFirst} autoCapitalize="words" />
      <LabeledInput label="Last name" value={last} onChangeText={setLast} autoCapitalize="words" />
      <LabeledInput label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      <LabeledInput label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <LabeledInput label="Source" value={source} onChangeText={setSource} />
    </Form>
  );
}

function Form({
  title,
  busy,
  error,
  canSubmit,
  onSubmit,
  children,
}: {
  title: string;
  busy: boolean;
  error: string | null;
  canSubmit: boolean;
  onSubmit: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container}>
        <ScreenHeader title={title} />
        <View style={{ gap: 12 }}>
          {children}
          {error ? <ErrorBox message={error} /> : null}
          <View style={{ marginTop: 8 }}>
            <PrimaryButton title="Save" busy={busy} disabled={!canSubmit} onPress={onSubmit} />
          </View>
          <Text style={styles.hint}>First and last name are required.</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 64, backgroundColor: colors.bg, minHeight: '100%' },
  hint: { color: colors.muted, fontSize: 13 },
});
