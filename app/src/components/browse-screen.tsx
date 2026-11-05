import { Alert, FlatList, RefreshControl, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { api, post } from '@/lib/hosts';
import { Button, Icon, Note, Row, c, useLoad } from '@/components/ui';

// Walk folders under the Mac's home folder to start an agent where none has run yet.
export default function Browse() {
  const { path } = useLocalSearchParams<{ path?: string }>();
  const { data, error, loading, load } = useLoad(() => api<string[]>('/dirs' + (path ? '?path=' + encodeURIComponent(path) : '')), [path]);

  const terminal = () =>
    path && post<{ name: string }>('/terms', { cwd: path }).then((r) => router.push({ pathname: '/term/[name]', params: { name: r.name, cwd: path } }), (e) => Alert.alert('Could not open a terminal', e.message));

  return (
    <>
      <Stack.Screen options={{ title: path ? path.split('/').pop() : 'Home' }} />
      <FlatList
        style={{ flex: 1, backgroundColor: c.bg as any }}
        contentInsetAdjustmentBehavior="automatic"
        data={data ?? []}
        keyExtractor={(d) => d}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListHeaderComponent={
          <>
            {!!path && (
              <View style={{ flexDirection: 'row', gap: 8, padding: 12 }}>
                <View style={{ flex: 1 }}><Button kind="accent" icon="square.and.pencil" label="New thread here" onPress={() => router.push({ pathname: '/new', params: { cwd: path } })} /></View>
                <View style={{ flex: 1 }}><Button icon="terminal" label="Terminal" onPress={terminal} /></View>
              </View>
            )}
            {!!error && <Note error>{error}</Note>}
          </>
        }
        ListEmptyComponent={data ? <Note>No subfolders.</Note> : undefined}
        renderItem={({ item: d }) => (
          <Row icon={<Icon name="folder" size={20} color={c.blue} />} title={d.split('/').pop()!} right={<Icon name="chevron.right" size={13} color={c.faint} />} onPress={() => router.push({ pathname: '/browse', params: { path: d } })} />
        )}
      />
    </>
  );
}
