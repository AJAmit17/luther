import type { ReactElement, ReactNode } from 'react';
import { FlatList, RefreshControl, View, type ListRenderItem } from 'react-native';
import { Note, SkeletonList, space, useTheme } from '@/design';

/** A screen that is one list: pull to refresh, the error above, placeholders while loading, then `empty`. */
export function ListScreen<T>({ data, error, pull, keyExtractor, renderItem, header, empty, footer }: {
  data: T[] | null | undefined;
  error?: string;
  pull: { refreshing: boolean; onRefresh: () => void };
  keyExtractor: (item: T) => string;
  renderItem: ListRenderItem<T>;
  header?: ReactNode;
  empty?: ReactElement;
  footer?: ReactElement;
}) {
  const { color } = useTheme();
  return (
    <FlatList
      data={data ?? []}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: color.bg }}
      contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: space.xxl + space.sm }}
      refreshControl={<RefreshControl {...pull} />}
      ListHeaderComponent={
        header || error ? (
          <View style={{ gap: space.sm }}>
            {header}
            {!!error && <Note tone="danger">{error}</Note>}
          </View>
        ) : undefined
      }
      ListEmptyComponent={data == null ? (error ? undefined : <SkeletonList />) : empty}
      ListFooterComponent={footer}
    />
  );
}
