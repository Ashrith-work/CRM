import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { MoneyByCurrency, SalesTiles } from '@crm/types';
import { colors, ErrorBox, Loading } from '../ui';
import { useAuthedLoad } from '../useAuthedLoad';
import { formatMoney, getSalesTiles } from '../api';
import { ScreenHeader } from './ScreenHeader';

type Period = 'week' | 'month' | 'quarter';
const PERIODS: Array<{ key: Period; label: string }> = [
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'quarter', label: 'This quarter' },
];

/** Read-only "My performance" glance — always own-scoped (scope=me). */
export function Performance(): React.JSX.Element {
  const [period, setPeriod] = useState<Period>('month');
  const { state, reload } = useAuthedLoad<SalesTiles>(
    (t) => getSalesTiles(t, { period, scope: 'me' }),
    [period],
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ScreenHeader title="My performance" />

      <View style={styles.toggleRow}>
        {PERIODS.map((p) => {
          const active = p.key === period;
          return (
            <TouchableOpacity
              key={p.key}
              style={[styles.toggle, active && styles.toggleActive]}
              onPress={() => setPeriod(p.key)}
            >
              <Text style={[styles.toggleText, active && styles.toggleTextActive]}>{p.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {state.status === 'loading' ? <Loading /> : null}
      {state.status === 'error' ? <ErrorBox message={state.message} onRetry={() => void reload()} /> : null}
      {state.status === 'ready' ? <Tiles tiles={state.data} /> : null}
    </ScrollView>
  );
}

function Tiles({ tiles }: { tiles: SalesTiles }): React.JSX.Element {
  return (
    <View style={{ gap: 12 }}>
      <View style={styles.grid}>
        <Tile label="Open pipeline" money={tiles.pipelineValue} />
        <Tile label="Weighted" money={tiles.weightedPipeline} />
        <Tile label="Deals won" value={String(tiles.dealsWon)} sub={moneyLines(tiles.revenueWon)} />
        <Tile label="Win rate" value={formatRate(tiles.winRate)} />
        <Tile label="Overdue tasks" value={String(tiles.tasksOverdue)} danger={tiles.tasksOverdue > 0} />
        <Tile label="Tasks done" value={String(tiles.tasksDone)} />
      </View>
      <Text style={styles.tz}>
        {tiles.period.preset === 'quarter' ? 'This quarter' : tiles.period.preset === 'week' ? 'This week' : 'This month'} ·
        times in {tiles.period.timezone}
      </Text>
    </View>
  );
}

function Tile({
  label,
  value,
  money,
  sub,
  danger,
}: {
  label: string;
  value?: string;
  money?: MoneyByCurrency;
  sub?: string[];
  danger?: boolean;
}): React.JSX.Element {
  const lines = money ? moneyLines(money) : value ? [value] : ['—'];
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      {lines.map((l, i) => (
        <Text key={i} style={[styles.tileValue, danger && styles.danger, i > 0 && styles.tileValueSecondary]}>
          {l}
        </Text>
      ))}
      {sub?.map((s, i) => (
        <Text key={`s${i}`} style={styles.tileSub}>
          {s}
        </Text>
      ))}
    </View>
  );
}

/** Render each currency on its own line; empty → single em dash. */
function moneyLines(money: MoneyByCurrency): string[] {
  if (money.length === 0) return ['—'];
  return money.map((m) => formatMoney(m.amountMinor, m.currency));
}

function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 64, backgroundColor: colors.bg, minHeight: '100%' },
  toggleRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  toggle: {
    borderWidth: 1,
    borderColor: colors.borderInput,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  toggleActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  toggleText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  toggleTextActive: { color: '#fff' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: '46%',
  },
  tileLabel: { fontSize: 12, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', marginBottom: 6 },
  tileValue: { fontSize: 22, fontWeight: '800', color: colors.text },
  tileValueSecondary: { fontSize: 16, fontWeight: '700' },
  danger: { color: colors.danger },
  tileSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  tz: { color: colors.muted, fontSize: 12, marginTop: 4 },
});
