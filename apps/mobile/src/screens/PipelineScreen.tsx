import { useCallback, useEffect, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import type { BoardResponse, Pipeline, StageType } from '@crm/types';
import { colors, ErrorBox, Loading } from '../ui';
import { useNav } from '../navigation';
import { formatMoney, getBoard, listPipelines } from '../api';
import { ScreenHeader } from './ScreenHeader';

export function stageColor(type: StageType): string {
  if (type === 'WON') return '#16a34a';
  if (type === 'LOST') return '#dc2626';
  return colors.brand;
}

/** Stage-segmented pipeline view: pick a stage, see its deals + per-stage totals. */
export function PipelineScreen(): React.JSX.Element {
  const { getToken } = useAuth();
  const { push } = useNav();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [stageId, setStageId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadBoard = useCallback(
    async (pid: string) => {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        if (!token) throw new Error('No session token');
        const b = await getBoard(token, pid);
        setBoard(b);
        setStageId((cur) =>
          cur && b.columns.some((c) => c.stage.id === cur) ? cur : (b.columns[0]?.stage.id ?? null),
        );
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [getToken],
  );

  const init = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('No session token');
      const res = await listPipelines(token);
      setPipelines(res.data);
      const def = res.data.find((p) => p.isDefault) ?? res.data[0];
      if (!def) {
        setBoard(null);
        setLoading(false);
        return;
      }
      setPipelineId(def.id);
      await loadBoard(def.id);
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }, [getToken, loadBoard]);

  useEffect(() => {
    void init();
  }, [init]);

  const selectPipeline = (pid: string) => {
    setPipelineId(pid);
    void loadBoard(pid);
  };

  const column = board?.columns.find((c) => c.stage.id === stageId) ?? null;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={() => (pipelineId ? void loadBoard(pipelineId) : void init())} />
      }
    >
      <ScreenHeader
        title="Pipeline"
        right={
          <TouchableOpacity onPress={() => push({ name: 'quickAddDeal' })} hitSlop={8}>
            <Text style={styles.add}>＋ Deal</Text>
          </TouchableOpacity>
        }
      />

      {error ? <ErrorBox message={error} onRetry={() => void init()} /> : null}
      {loading && !board ? <Loading /> : null}

      {board ? (
        <>
          {pipelines.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pipeRow}>
              {pipelines.map((p) => {
                const active = p.id === pipelineId;
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.pipeChip, active && styles.pipeChipActive]}
                    onPress={() => selectPipeline(p.id)}
                  >
                    <Text style={[styles.pipeChipText, active && styles.pipeChipTextActive]}>{p.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : null}

          <Text style={styles.summary}>
            {board.totals.count} deals · {formatMoney(board.totals.sumMinor, currencyOf(board))} · weighted{' '}
            {formatMoney(board.totals.weightedMinor, currencyOf(board))}
          </Text>

          {/* Stage segments */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stageRow}>
            {board.columns.map((col) => {
              const active = col.stage.id === stageId;
              const c = stageColor(col.stage.type);
              return (
                <TouchableOpacity
                  key={col.stage.id}
                  style={[styles.stageCard, active && { borderColor: c, borderWidth: 2 }]}
                  onPress={() => setStageId(col.stage.id)}
                >
                  <Text style={[styles.stageName, { color: c }]}>{col.stage.name}</Text>
                  <Text style={styles.stageMeta}>{col.totals.count} · {col.stage.probability}%</Text>
                  <Text style={styles.stageAmount}>{formatMoney(col.totals.sumMinor, currencyOf(board))}</Text>
                  <Text style={styles.stageWeighted}>wtd {formatMoney(col.totals.weightedMinor, currencyOf(board))}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Deals in the selected stage */}
          <View style={{ gap: 8, marginTop: 4 }}>
            {column && column.deals.length === 0 ? (
              <Text style={styles.empty}>No deals in {column.stage.name}.</Text>
            ) : null}
            {column?.deals.map((d) => (
              <TouchableOpacity key={d.id} style={styles.dealRow} onPress={() => push({ name: 'dealDetail', id: d.id })}>
                <View style={{ flexShrink: 1 }}>
                  <Text style={styles.dealName}>{d.name}</Text>
                  <Text style={styles.dealSub}>
                    {d.contact ? `${d.contact.firstName} ${d.contact.lastName}` : d.company?.name ?? '—'}
                    {d.expectedCloseDate ? ` · ${new Date(d.expectedCloseDate).toLocaleDateString()}` : ''}
                  </Text>
                </View>
                <Text style={styles.dealAmount}>{formatMoney(d.amountMinor, d.currency)}</Text>
              </TouchableOpacity>
            ))}
            {column?.nextCursor ? <Text style={styles.more}>Showing the first {column.deals.length}. Open a deal to see full detail.</Text> : null}
          </View>
        </>
      ) : null}

      {!loading && !error && !board ? <Text style={styles.empty}>No pipeline configured yet.</Text> : null}
    </ScrollView>
  );
}

/** All deals in a board share the org currency; read it off the first available deal. */
function currencyOf(board: BoardResponse): string {
  for (const col of board.columns) {
    if (col.deals[0]) return col.deals[0].currency;
  }
  return 'USD';
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 64, backgroundColor: colors.bg, minHeight: '100%', gap: 12 },
  add: { color: colors.brand, fontWeight: '700', fontSize: 15 },
  summary: { color: colors.muted, fontSize: 13 },
  pipeRow: { gap: 8, paddingBottom: 4 },
  pipeChip: { borderWidth: 1, borderColor: colors.borderInput, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  pipeChipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  pipeChipText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  pipeChipTextActive: { color: '#fff' },
  stageRow: { gap: 10, paddingVertical: 4 },
  stageCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    minWidth: 130,
  },
  stageName: { fontSize: 14, fontWeight: '700' },
  stageMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  stageAmount: { color: colors.text, fontWeight: '700', marginTop: 6 },
  stageWeighted: { color: colors.muted, fontSize: 12, marginTop: 2 },
  dealRow: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  dealName: { fontSize: 16, fontWeight: '600', color: colors.text },
  dealSub: { color: colors.muted, marginTop: 2, fontSize: 13 },
  dealAmount: { fontWeight: '700', color: colors.text },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 24 },
  more: { color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: 4 },
});
