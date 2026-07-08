import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import { colors, ErrorBox, Pill } from '../ui';
import { useNav, type Screen } from '../navigation';
import { ScreenHeader } from './ScreenHeader';
import type { ListParams, TokenGetter } from '../api';

export interface RowContent {
  primary: string;
  secondary?: string;
  badge?: { label: string; color?: string };
}

/** Generic searchable, cursor-paginated list screen. */
export function ListView<T extends { id: string }>({
  title,
  addScreen,
  fetchPage,
  renderRow,
  onOpen,
}: {
  title: string;
  addScreen?: Screen;
  fetchPage: (getToken: TokenGetter, params: ListParams) => Promise<{ data: T[]; nextCursor: string | null }>;
  renderRow: (item: T) => RowContent;
  onOpen: (item: T) => void;
}): React.JSX.Element {
  const { getToken } = useAuth();
  const { push } = useNav();
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (opts: { append: boolean; nextCursor?: string; term?: string }) => {
      if (opts.append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const page = await fetchPage(getToken, {
          search: opts.term ?? search,
          cursor: opts.append ? (opts.nextCursor ?? undefined) : undefined,
          limit: 25,
        });
        setItems((prev) => (opts.append ? [...prev, ...page.data] : page.data));
        setCursor(page.nextCursor);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [getToken, fetchPage, search],
  );

  useEffect(() => {
    void load({ append: false, term: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 20, paddingTop: 64, gap: 8 }}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={() => void load({ append: false })} />
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (cursor && !loadingMore) void load({ append: true, nextCursor: cursor });
        }}
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 4 }}>
            <ScreenHeader
              title={title}
              right={
                addScreen ? (
                  <TouchableOpacity onPress={() => push(addScreen)} hitSlop={8}>
                    <Text style={styles.add}>＋ Add</Text>
                  </TouchableOpacity>
                ) : undefined
              }
            />
            <TextInput
              style={styles.search}
              placeholder="Search…"
              autoCapitalize="none"
              value={search}
              onChangeText={setSearch}
              returnKeyType="search"
              onSubmitEditing={() => void load({ append: false })}
            />
            {error ? <ErrorBox message={error} onRetry={() => void load({ append: false })} /> : null}
          </View>
        }
        renderItem={({ item }) => {
          const row = renderRow(item);
          return (
            <TouchableOpacity style={styles.row} onPress={() => onOpen(item)}>
              <View style={{ flexShrink: 1 }}>
                <Text style={styles.rowPrimary}>{row.primary}</Text>
                {row.secondary ? <Text style={styles.rowSecondary}>{row.secondary}</Text> : null}
              </View>
              {row.badge ? <Pill label={row.badge.label} color={row.badge.color} /> : null}
            </TouchableOpacity>
          );
        }}
        ListFooterComponent={
          loadingMore ? <ActivityIndicator style={{ marginVertical: 16 }} color={colors.brand} /> : null
        }
        ListEmptyComponent={
          !loading && !error ? (
            <Text style={styles.empty}>No {title.toLowerCase()} yet.</Text>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  add: { color: colors.brand, fontWeight: '700', fontSize: 15 },
  search: {
    borderWidth: 1,
    borderColor: colors.borderInput,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  row: {
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
  rowPrimary: { fontSize: 16, fontWeight: '600', color: colors.text },
  rowSecondary: { color: colors.muted, marginTop: 2 },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 32 },
});
