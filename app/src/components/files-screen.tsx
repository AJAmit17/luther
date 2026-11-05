import { FlatList, RefreshControl, ScrollView, Text } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { api } from '@/lib/hosts';
import type { FileContent, FileEntry } from '@/lib/protocol';
import { Icon, Note, Row, c, mono, useLoad, listStyle } from '@/components/ui';

const size = (n: number) => (n >= 1 << 20 ? (n / (1 << 20)).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B');

// Project files: a folder lists its entries, a file shows (and text files open in the editor).
export default function Files() {
  const { cwd, path = '' } = useLocalSearchParams<{ cwd: string; path?: string }>();
  const { data, error, loading, load } = useLoad(
    () => api<FileEntry[] | FileContent>(`/files?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`),
    [cwd, path],
  );
  const title = path ? path.split('/').pop() : cwd.split('/').pop();

  if (data && !Array.isArray(data)) {
    return (
      <>
        <Stack.Screen options={{ title }} />
        {!!data.hash && (
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Button icon="square.and.pencil" onPress={() => router.push({ pathname: '/edit', params: { cwd, path } })} />
          </Stack.Toolbar>
        )}
        <ScrollView style={{ flex: 1, backgroundColor: c.bg as any }} contentInsetAdjustmentBehavior="automatic">
          {data.binary ? (
            <Note>Binary file; not shown.</Note>
          ) : (
            <ScrollView horizontal contentContainerStyle={{ padding: 12 }}>
              <Text selectable style={{ color: c.text, fontFamily: mono, fontSize: 12, lineHeight: 17 }}>{data.text}</Text>
            </ScrollView>
          )}
          {!!data.truncated && <Note>Showing the first 512 KB.</Note>}
        </ScrollView>
      </>
    );
  }
  return (
    <>
      <Stack.Screen options={{ title }} />
      <FlatList
        contentContainerStyle={listStyle}
        style={{ flex: 1, backgroundColor: c.bg as any }}
        contentInsetAdjustmentBehavior="automatic"
        data={(data as FileEntry[] | null) ?? []}
        keyExtractor={(e) => e.name}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListHeaderComponent={error ? <Note error>{error}</Note> : undefined}
        ListEmptyComponent={data ? <Note>Empty folder.</Note> : undefined}
        renderItem={({ item: e }) => (
          <Row
            icon={<Icon name={e.dir ? 'folder' : 'doc'} size={20} color={e.dir ? c.blue : c.dim} />}
            title={e.name}
            right={e.dir ? <Icon name="chevron.right" size={13} color={c.faint} /> : <Text style={{ color: c.faint, fontSize: 12 }}>{size(e.size)}</Text>}
            onPress={() => router.push({ pathname: '/files', params: { cwd, path: path ? `${path}/${e.name}` : e.name } })}
          />
        )}
      />
    </>
  );
}
