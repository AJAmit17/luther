import { FlatList, RefreshControl } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { api } from '@/lib/hosts';
import type { Turn } from '@/lib/protocol';
import { Icon, Note, Row, ago, c, useLoad, listStyle } from '@/components/ui';

// Every turn of an open thread, newest first, with the files it changed. Tap
// one for its diff and to roll the project back to before it.
export default function Turns() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error, loading, load } = useLoad(() => api<Turn[]>(`/threads/${encodeURIComponent(id)}/turns`), [id]);
  return (
    <>
      <Stack.Screen options={{ title: 'Turns' }} />
      <FlatList
        contentContainerStyle={listStyle}
        style={{ flex: 1, backgroundColor: c.bg as any }}
        contentInsetAdjustmentBehavior="automatic"
        data={data ?? []}
        keyExtractor={(t) => String(t.n)}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListHeaderComponent={error ? <Note error>{error}</Note> : undefined}
        ListEmptyComponent={data ? <Note>No turns yet. Each message you send starts one; its changes show up here.</Note> : undefined}
        renderItem={({ item: t }) => (
          <Row
            icon={<Icon name={t.endedAt ? 'clock.arrow.circlepath' : 'circle.dotted'} color={t.endedAt ? c.dim : c.accent} />}
            title={t.prompt || '(attachments)'}
            sub={`Turn ${t.n} · ${ago(t.startedAt)} · ${t.files === 1 ? '1 file' : `${t.files} files`}${t.endedAt ? '' : ' · running'}`}
            onPress={() => router.push({ pathname: '/diff', params: { thread: id, n: String(t.n) } })}
          />
        )}
      />
    </>
  );
}
