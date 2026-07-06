import type { ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../ui';
import { useNav } from '../navigation';

/** Top bar: optional back chevron + title + optional right-side action. */
export function ScreenHeader({ title, right }: { title: string; right?: ReactNode }): React.JSX.Element {
  const { pop, canPop } = useNav();
  return (
    <View style={styles.header}>
      <View style={styles.left}>
        {canPop ? (
          <TouchableOpacity onPress={pop} hitSlop={8}>
            <Text style={styles.back}>‹ Back</Text>
          </TouchableOpacity>
        ) : null}
        <Text style={styles.title}>{title}</Text>
      </View>
      {right ?? null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1 },
  back: { color: colors.brand, fontWeight: '600', fontSize: 15 },
  title: { fontSize: 24, fontWeight: '700', color: colors.text, flexShrink: 1 },
});
