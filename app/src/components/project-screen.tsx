import { useMemo, useState } from 'react';
import { Alert, FlatList, RefreshControl, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { api, post } from '@/lib/hosts';
import type { Session } from '@/lib/protocol';
import { openThread } from '@/lib/threads';
import { Button, Empty, Icon, Note, Pill, ProviderIcon, Row, ago, c, listStyle, providerName, useLoad, useHex, searchColors } from '@/components/ui';
import { tb } from '@/components/toolbar-icon';
import { onSessionAction, sessionActions } from '@/components/session-menu';

// One project folder: every past conversation (any agent), pinned first, then
// newest. Conversations that ran in a Luther worktree show their branch.
export default function ProjectScreen() {
  useHex();
  const { cwd, name } = useLocalSearchParams<{ cwd: string; name: string }>();
  const [archived, setArchived] = useState(false);
  const [q, setQ] = useState('');
  const { data, error, load, pull } = useLoad(
    () => api<Session[]>(`/sessions?cwd=${encodeURIComponent(cwd)}${archived ? '&archived=1' : ''}`),
    [cwd, archived],
    'sessions',
  );
  const hx = useHex();
  const search = useMemo(() => ({ ...searchColors(hx), placeholder: 'Search conversations', onChangeText: (e: { nativeEvent: { text: string } }) => setQ(e.nativeEvent.text) }), [hx]);
  const needle = q.trim().toLowerCase();
  const shown = (data ?? []).filter((s) => !needle || `${s.title} ${s.preview} ${s.worktree ?? ''}`.toLowerCase().includes(needle));
  const go = (pathname: '/files' | '/git' | '/preview' | '/instructions' | '/schedule' | '/new' | '/compares') => router.push({ pathname, params: { cwd } });

  const terminal = () =>
    post<{ name: string }>('/terms', { cwd }).then((r) => router.push({ pathname: '/term/[name]', params: { name: r.name, cwd } }), (e) => Alert.alert('Could not open a terminal', e.message));

  return (
    <>
      <Stack.Screen
        options={{
          title: archived ? 'Archived' : name || cwd.split('/').pop(),
          headerSearchBarOptions: search,
        }}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon={tb('terminal')} onPress={terminal} />
        <Stack.Toolbar.Menu icon={tb('ellipsis')}>
          <Stack.Toolbar.MenuAction icon={tb('folder')} onPress={() => go('/files')}>Files</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon={tb('arrow.triangle.branch')} onPress={() => go('/git')}>Changes</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon={tb('globe')} onPress={() => go('/preview')}>Preview dev server</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon={tb('text.book.closed')} onPress={() => go('/instructions')}>Instructions</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon={tb('calendar.badge.plus')} onPress={() => go('/schedule')}>Schedule a run</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon={tb('square.on.square')} onPress={() => go('/compares')}>Compare agents</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon={tb('archivebox')} isOn={archived} onPress={() => setArchived((a) => !a)}>Show archived</Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.Button icon={tb('square.and.pencil')} onPress={() => go('/new')} />
      </Stack.Toolbar>
      <FlatList
        style={{ flex: 1, backgroundColor: c.bg }}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={listStyle}
        data={shown}
        keyExtractor={(s) => s.provider + s.id}
        refreshControl={<RefreshControl {...pull} />}
        ListHeaderComponent={error ? <Note error>{error}</Note> : undefined}
        ListEmptyComponent={
          data ? (
            needle ? (
              <Empty icon="magnifyingglass" title={`No results for “${q.trim()}”`} />
            ) : archived ? (
              <Empty icon="archivebox" title="Nothing archived" sub="Archive a conversation from its long-press menu to tuck it away." />
            ) : (
              <Empty icon="bubble.left.and.bubble.right" title="No conversations yet" sub="Start one, and it runs right here on your Mac." action={<View style={{ paddingTop: 12 }}><Button kind="accent" icon="square.and.pencil" label="New thread" onPress={() => go('/new')} /></View>} />
            )
          ) : undefined
        }
        renderItem={({ item: s }) => <SessionRow s={s} onChange={load} />}
      />
    </>
  );
}

export function SessionRow({ s, onChange, showDir }: { s: Session; onChange: () => void; showDir?: boolean }) {
  useHex();
  const open = () => (s.live ? router.push({ pathname: '/thread/[id]', params: { id: s.live, cwd: s.cwd } }) : openThread({ provider: s.provider, cwd: s.cwd, resume: s.id }));
  const meta = [providerName(s.provider), ago(s.lastActive), showDir ? s.cwd.split('/').pop() : '', s.preview && s.preview !== s.title ? s.preview : ''].filter(Boolean).join(' · ');
  return (
    <Row
      icon={<ProviderIcon p={s.provider} />}
      title={s.title || 'Untitled conversation'}
      sub={meta}
      right={
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          {s.live ? <Pill label="Live" tone="green" /> : s.busy ? <Pill label="In terminal" tone="warn" /> : null}
          {!!s.worktree && <Pill label={s.worktree.replace(/^luther\//, '')} tone="blue" icon="arrow.triangle.branch" />}
          {s.pinned && !s.live && !s.busy && !s.worktree ? <Icon name="pin.fill" size={12} color={c.accent} /> : null}
        </View>
      }
      onPress={open}
      menu={sessionActions(s)}
      onMenu={(id) => onSessionAction(id, s, open, onChange)}
    />
  );
}
