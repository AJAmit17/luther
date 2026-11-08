import { FlatList, RefreshControl, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { api } from '@/lib/hosts';
import type { Compare } from '@/lib/protocol';
import { Icon, Note, ProviderMark, Row, ago, c, useLoad, listStyle, useHex } from '@/components/ui';
import { tb } from '@/components/toolbar-icon';

// A project's comparisons, newest first.
export default function Compares() {
  useHex();
  const { cwd } = useLocalSearchParams<{ cwd: string }>();
  const { data, error, pull } = useLoad(() => api<Compare[]>('/compares?cwd=' + encodeURIComponent(cwd)), [cwd]);
  return (
    <>
      <Stack.Screen options={{ title: 'Compare agents' }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon={tb('plus')} onPress={() => router.push({ pathname: '/compare-new', params: { cwd } })} />
      </Stack.Toolbar>
      <FlatList
        contentContainerStyle={listStyle}
        style={{ flex: 1, backgroundColor: c.bg as any }}
        contentInsetAdjustmentBehavior="automatic"
        data={data ?? []}
        keyExtractor={(x) => x.id}
        refreshControl={<RefreshControl {...pull} />}
        ListHeaderComponent={error ? <Note error>{error}</Note> : undefined}
        ListEmptyComponent={data ? <Note>Give one task to several agents at once, each in its own worktree, and keep the best result. Tap + to start.</Note> : undefined}
        renderItem={({ item: x }) => {
          const live = x.runs.filter((r) => r.status === 'working' || r.status === 'waiting').length;
          return (
            <Row
              icon={<View style={{ flexDirection: 'row', gap: 2 }}>{x.runs.slice(0, 3).map((r, i) => <ProviderMark key={i} p={r.provider} size={14} />)}</View>}
              title={x.prompt}
              sub={`${x.runs.length} agents · ${ago(x.created)} ago${live ? ` · ${live} working` : ''}${x.kept ? ' · kept one' : ''}`}
              right={<Icon name="chevron.right" size={13} color={c.faint} />}
              onPress={() => router.push({ pathname: '/compare/[id]', params: { id: x.id } })}
            />
          );
        }}
      />
    </>
  );
}
