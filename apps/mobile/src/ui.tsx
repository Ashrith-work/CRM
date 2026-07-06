import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

/** Shared palette (matches the web brand tokens + slate scale). */
export const colors = {
  brand: '#274fd6',
  brandDark: '#1e3fb0',
  bg: '#f8fafc',
  card: '#fff',
  border: '#e2e8f0',
  borderInput: '#cbd5e1',
  muted: '#64748b',
  text: '#0f172a',
  errorBg: '#fef2f2',
  errorBorder: '#fecaca',
  errorText: '#b91c1c',
  danger: '#dc2626',
};

export function Loading(): React.JSX.Element {
  return <ActivityIndicator style={{ marginTop: 24 }} color={colors.brand} />;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }): React.JSX.Element {
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorText}>{message}</Text>
      {onRetry ? (
        <TouchableOpacity style={styles.retry} onPress={onRetry}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }): React.JSX.Element {
  return (
    <View style={styles.card}>
      {title ? <Text style={styles.cardTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

export function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export function PrimaryButton({
  title,
  onPress,
  busy,
  disabled,
}: {
  title: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <TouchableOpacity
      style={[styles.primary, (busy || disabled) && styles.disabled]}
      onPress={onPress}
      disabled={busy || disabled}
    >
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{title}</Text>}
    </TouchableOpacity>
  );
}

export function SecondaryButton({
  title,
  onPress,
}: {
  title: string;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <TouchableOpacity style={styles.secondary} onPress={onPress}>
      <Text style={styles.secondaryText}>{title}</Text>
    </TouchableOpacity>
  );
}

export function LabeledInput({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'email-address' | 'phone-pad';
  autoCapitalize?: 'none' | 'sentences' | 'words';
}): React.JSX.Element {
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
      />
    </View>
  );
}

export function Pill({ label, color }: { label: string; color?: string }): React.JSX.Element {
  return (
    <View style={[styles.pill, color ? { backgroundColor: color + '22', borderColor: color } : null]}>
      <Text style={[styles.pillText, color ? { color } : null]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, gap: 12 },
  rowLabel: { color: colors.muted },
  rowValue: { fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  primary: { backgroundColor: colors.brand, borderRadius: 10, padding: 14, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.6 },
  secondary: {
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
  },
  secondaryText: { color: colors.brand, fontSize: 15, fontWeight: '600' },
  inputLabel: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: colors.borderInput,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  errorBox: {
    backgroundColor: colors.errorBg,
    borderColor: colors.errorBorder,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
  },
  errorText: { color: colors.errorText },
  retry: { backgroundColor: colors.danger, borderRadius: 8, padding: 10, alignItems: 'center', marginTop: 10 },
  retryText: { color: '#fff', fontWeight: '600' },
  pill: {
    backgroundColor: '#eef2ff',
    borderColor: colors.brand,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  pillText: { fontSize: 12, fontWeight: '600', color: colors.brand },
});
