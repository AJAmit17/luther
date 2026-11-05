import { Alert, FlatList, RefreshControl } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { api, post } from '@/lib/hosts';
import type { Session } from '@/lib/protocol';
import { openThread } from '@/lib/push';
import { Badge, Note, ProviderIcon, Row, ago, c, providerName, useLoad } from '@/lib/ui';

// One project folder: every past conversation (Claude and Codex), newest first.
export default function ProjectScreen() {
  const { cwd, name } = useLocalSearchParams<{ cwd: string; name: string }>();
  const { data, error, loading, load } = useLoad(() => api<Session[]>('/sessions?cwd=' + encodeURIComponent(cwd)), [cwd]);

  const terminal = () =>
    post<{ name: string }>('/terms', { cwd }).then((r) => router.push({ pathname: '/term/[name]', params: { name: r.name, cwd } }), (e) => Alert.alert('Could not open a terminal', e.message));

  const open = (s: Session) =>
    s.live ? router.push({ pathname: '/thread/[id]', params: { id: s.live, cwd } }) : openThread({ provider: s.provider, cwd, resume: s.id });

  const menu = (s: Session) =>
    Alert.alert(s.title || 'Conversation', s.preview || undefined, [
      { text: 'Resume', onPress: () => open(s) },
      { text: 'Fork a copy', onPress: () => openThread({ provider: s.provider, cwd, resume: s.id, fork: true }) },
      { text: 'Cancel', style: 'cancel' },
    ]);

  return (
    <>
      <Stack.Screen options={{ title: name || cwd.split('/').pop() }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="terminal" onPress={terminal} />
        <Stack.Toolbar.Menu icon="ellipsis.circle">
          <Stack.Toolbar.MenuAction icon="folder" onPress={() => router.push({ pathname: '/files', params: { cwd } })}>Files</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="arrow.triangle.branch" onPress={() => router.push({ pathname: '/git', params: { cwd } })}>Changes</Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.Button icon="square.and.pencil" onPress={() => router.push({ pathname: '/new', params: { cwd } })} />
      </Stack.Toolbar>
      <FlatList
        style={{ flex: 1, backgroundColor: c.bg as any }}
        contentInsetAdjustmentBehavior="automatic"
        data={data ?? []}
        keyExtractor={(s) => s.provider + s.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListHeaderComponent={error ? <Note error>{error}</Note> : undefined}
        ListEmptyComponent={data ? <Note>No conversations here yet. Tap the compose button to start one.</Note> : undefined}
        renderItem={({ item: s }) => (
          <Row
            icon={<ProviderIcon p={s.provider} />}
            title={s.title || '(untitled)'}
            sub={`${providerName(s.provider)} · ${ago(s.lastActive)}${s.preview && s.preview !== s.title ? ' · ' + s.preview : ''}`}
            right={s.live ? <Badge label="live" color={c.green} /> : s.busy ? <Badge label="in terminal" /> : undefined}
            onPress={() => open(s)}
            onLongPress={() => menu(s)}
          />
        )}
      />
    </>
  );
}
