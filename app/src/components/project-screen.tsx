import { useState } from 'react';
import { Alert, FlatList, RefreshControl, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { api, post } from '@/lib/hosts';
import type { Session } from '@/lib/protocol';
import { openThread } from '@/lib/threads';
import { Badge, Icon, Note, ProviderIcon, Row, ago, c, providerName, useLoad } from '@/components/ui';
import { sessionMenu } from '@/components/session-menu';

// One project folder: every past conversation (Claude and Codex), pinned first,
// then newest. Worktree conversations are folded in with their branch.
export default function ProjectScreen() {
  const { cwd, name } = useLocalSearchParams<{ cwd: string; name: string }>();
  const [archived, setArchived] = useState(false);
  const [q, setQ] = useState('');
  const { data, error, loading, load } = useLoad(
    () => api<Session[]>(`/sessions?cwd=${encodeURIComponent(cwd)}${archived ? '&archived=1' : ''}`),
    [cwd, archived],
    'sessions',
  );
  const needle = q.trim().toLowerCase();
  const shown = (data ?? []).filter((s) => !needle || `${s.title} ${s.preview} ${s.worktree ?? ''}`.toLowerCase().includes(needle));

  const terminal = () =>
    post<{ name: string }>('/terms', { cwd }).then((r) => router.push({ pathname: '/term/[name]', params: { name: r.name, cwd } }), (e) => Alert.alert('Could not open a terminal', e.message));

  return (
    <>
      <Stack.Screen
        options={{
          title: archived ? 'Archived' : name || cwd.split('/').pop(),
          headerSearchBarOptions: { placeholder: 'Search conversations', onChangeText: (e) => setQ(e.nativeEvent.text), hideWhenScrolling: true },
        }}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="terminal" onPress={terminal} />
        <Stack.Toolbar.Menu icon="ellipsis.circle">
          <Stack.Toolbar.MenuAction icon="folder" onPress={() => router.push({ pathname: '/files', params: { cwd } })}>Files</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="arrow.triangle.branch" onPress={() => router.push({ pathname: '/git', params: { cwd } })}>Changes</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="globe" onPress={() => router.push({ pathname: '/preview', params: { cwd } })}>Preview</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="text.book.closed" onPress={() => router.push({ pathname: '/instructions', params: { cwd } })}>Instructions</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="calendar.badge.clock" onPress={() => router.push({ pathname: '/schedules', params: { cwd } })}>Schedules</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="archivebox" isOn={archived} onPress={() => setArchived((a) => !a)}>Show archived</Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.Button icon="square.and.pencil" onPress={() => router.push({ pathname: '/new', params: { cwd } })} />
      </Stack.Toolbar>
      <FlatList
        style={{ flex: 1, backgroundColor: c.bg as any }}
        contentInsetAdjustmentBehavior="automatic"
        data={shown}
        keyExtractor={(s) => s.provider + s.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListHeaderComponent={error ? <Note error>{error}</Note> : undefined}
        ListEmptyComponent={
          data ? <Note>{needle ? 'Nothing matches.' : archived ? 'No archived conversations.' : 'No conversations here yet. Tap the compose button to start one.'}</Note> : undefined
        }
        renderItem={({ item: s }) => <SessionRow s={s} onChange={load} />}
      />
    </>
  );
}

export function SessionRow({ s, onChange, showDir }: { s: Session; onChange: () => void; showDir?: boolean }) {
  const open = () => (s.live ? router.push({ pathname: '/thread/[id]', params: { id: s.live, cwd: s.cwd } }) : openThread({ provider: s.provider, cwd: s.cwd, resume: s.id }));
  return (
    <Row
      icon={<ProviderIcon p={s.provider} />}
      title={s.title || '(untitled)'}
      sub={`${providerName(s.provider)} · ${ago(s.lastActive)}${showDir ? ' · ' + s.cwd.split('/').pop() : ''}${s.preview && s.preview !== s.title ? ' · ' + s.preview : ''}`}
      right={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {s.pinned && <Icon name="pin.fill" size={12} color={c.accent} />}
          {!!s.worktree && <Badge label={s.worktree.replace(/^luther\//, '⑂ ')} color={c.blue} />}
          {s.live ? <Badge label="live" color={c.green} /> : s.busy ? <Badge label="in terminal" /> : null}
        </View>
      }
      onPress={open}
      onLongPress={() => sessionMenu(s, open, onChange)}
    />
  );
}
