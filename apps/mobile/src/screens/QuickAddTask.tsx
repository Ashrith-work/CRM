import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import type { CreateTaskInput, EntityType, TaskType } from '@crm/types';
import { colors, ErrorBox, LabeledInput, PrimaryButton } from '../ui';
import { useNav } from '../navigation';
import { createTask } from '../api';
import { ScreenHeader } from './ScreenHeader';
import { TYPE_LABEL } from './taskShared';

const TYPES: TaskType[] = ['TASK', 'FOLLOW_UP', 'CALL', 'MEETING'];

type DueChoice = 'none' | 'today5' | 'tomorrow9' | 'week';

function dueIso(choice: DueChoice): string | undefined {
  const now = new Date();
  switch (choice) {
    case 'today5': {
      const d = new Date(now);
      d.setHours(17, 0, 0, 0);
      return d.toISOString();
    }
    case 'tomorrow9': {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d.toISOString();
    }
    case 'week':
      return new Date(now.getTime() + 7 * 86_400_000).toISOString();
    default:
      return undefined;
  }
}

const DUE_LABEL: Record<DueChoice, string> = {
  none: 'No date',
  today5: 'Today 5pm',
  tomorrow9: 'Tomorrow 9am',
  week: 'In a week',
};

/** Minimal task/follow-up composer, optionally linked to a CRM record. */
export function QuickAddTask({
  relatedType,
  relatedId,
}: {
  relatedType?: EntityType;
  relatedId?: string;
}): React.JSX.Element {
  const { getToken } = useAuth();
  const { pop } = useNav();
  const [type, setType] = useState<TaskType>(relatedType ? 'FOLLOW_UP' : 'TASK');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [due, setDue] = useState<DueChoice>('tomorrow9');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const when = dueIso(due);
      const body: CreateTaskInput = {
        type,
        title: title.trim(),
        description: description.trim() || undefined,
        priority: 'MEDIUM',
        ...(when ? (type === 'MEETING' ? { startAt: when } : { dueAt: when }) : {}),
        ...(when ? { reminders: [{ minutesBefore: 60 }] } : {}),
        ...(relatedType && relatedId ? { relatedType, relatedId } : {}),
      };
      await createTask(getToken, body);
      pop();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container}>
        <ScreenHeader title="New task" />
        <View style={{ gap: 12 }}>
          {relatedType && relatedId ? (
            <Text style={styles.linked}>Linked to a {relatedType.toLowerCase()}.</Text>
          ) : null}

          <Text style={styles.label}>Type</Text>
          <View style={styles.chipRow}>
            {TYPES.map((t) => (
              <Chip key={t} label={TYPE_LABEL[t]} active={t === type} onPress={() => setType(t)} />
            ))}
          </View>

          <LabeledInput label="Title" value={title} onChangeText={setTitle} autoCapitalize="sentences" />
          <LabeledInput label="Description (optional)" value={description} onChangeText={setDescription} autoCapitalize="sentences" />

          <Text style={styles.label}>Due</Text>
          <View style={styles.chipRow}>
            {(Object.keys(DUE_LABEL) as DueChoice[]).map((c) => (
              <Chip key={c} label={DUE_LABEL[c]} active={c === due} onPress={() => setDue(c)} />
            ))}
          </View>

          {error ? <ErrorBox message={error} /> : null}
          <View style={{ marginTop: 8 }}>
            <PrimaryButton title="Save" busy={busy} disabled={!title.trim()} onPress={() => void submit()} />
          </View>
          <Text style={styles.hint}>
            {due === 'none' ? 'No reminder without a due date.' : 'Reminds you 1 hour before, in your timezone.'}
          </Text>
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
  hint: { color: colors.muted, fontSize: 13 },
});
