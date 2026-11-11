import { View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Button, EmptyState, Group, ListItem, alert, space, useTheme } from '@/design';
import { ListScreen } from '@/features/list-screen';
import { api, post } from '@/lib/hosts';
import { useLoad } from '@/lib/use-load';

// Walk folders under the Mac's home folder to start an agent where none has run yet.
export default function Browse() {
  const { color } = useTheme();
  const { path } = useLocalSearchParams<{ path?: string }>();
  const { data, error, pull } = useLoad(() => api<string[]>('/dirs' + (path ? '?path=' + encodeURIComponent(path) : '')), [path]);

  const terminal = () =>
    path && post<{ name: string }>('/terms', { cwd: path }).then((r) => router.push({ pathname: '/term/[name]', params: { name: r.name, cwd: path } }), (e) => alert('Could not open a terminal', e.message));

  return (
    <>
      <Stack.Screen options={{ title: path ? path.split('/').pop() : 'Home' }} />
      <ListScreen
        data={data && (data.length ? [data] : [])}
        error={error}
        pull={pull}
        keyExtractor={() => 'dirs'}
        header={
          path ? (
            <View style={{ flexDirection: 'row', gap: space.sm, paddingBottom: space.sm }}>
              <View style={{ flex: 1 }}>
                <Button variant="primary" icon="square.and.pencil" label="New Thread Here" onPress={() => router.push({ pathname: '/new', params: { cwd: path } })} />
              </View>
              <View style={{ flex: 1 }}>
                <Button icon="terminal" label="Terminal" onPress={terminal} />
              </View>
            </View>
          ) : undefined
        }
        empty={<EmptyState icon="folder" title="No subfolders" message="Start a thread or open a terminal right here." />}
        renderItem={({ item }) => (
          <Group>
            {item.map((d) => (
              <ListItem key={d} icon="folder" iconColor={color.blue} title={d.split('/').pop()!} onPress={() => router.push({ pathname: '/browse', params: { path: d } })} />
            ))}
          </Group>
        )}
      />
    </>
  );
}
