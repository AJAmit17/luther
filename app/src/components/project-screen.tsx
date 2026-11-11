import { useState } from 'react';
import { View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Button, EmptyState, HeaderActions, Icon, ListItem, Pill, Press, SectionHeader, Surface, Text, alert, radius, space, useHeaderSearch, useTheme, type IconName } from '@/design';
import { AgentTile, agentName } from '@/features/agents';
import { ListScreen } from '@/features/list-screen';
import { api, post } from '@/lib/hosts';
import type { Session } from '@/lib/protocol';
import { openThread } from '@/lib/threads';
import { ago, home } from '@/lib/format';
import { useLoad } from '@/lib/use-load';
import { onSessionAction, sessionActions } from '@/components/session-menu';

type Place = '/files' | '/git' | '/preview' | '/instructions' | '/schedule' | '/new' | '/compares';

// One project folder: every past conversation (any agent), running ones first,
// then pinned, then newest. Conversations that ran in a Luther worktree show their branch.
export default function ProjectScreen() {
  const { color } = useTheme();
  const { cwd, name } = useLocalSearchParams<{ cwd: string; name: string }>();
  const [archived, setArchived] = useState(false);
  const [q, setQ] = useState('');
  const { data, error, load, pull } = useLoad(
    () => api<Session[]>(`/sessions?cwd=${encodeURIComponent(cwd)}${archived ? '&archived=1' : ''}`),
    [cwd, archived],
    'sessions',
  );
  const { headerSearchBarOptions, field: searchField } = useHeaderSearch({ placeholder: 'Search conversations', onChange: setQ, live: true });
  const needle = q.trim().toLowerCase();
  const matches = (data ?? []).filter((s) => !needle || `${s.title} ${s.preview} ${s.worktree ?? ''}`.toLowerCase().includes(needle));
  const running = matches.filter((s) => s.live || s.busy);
  const rest = matches.filter((s) => !s.live && !s.busy);
  const shown = data ? [...running, ...rest] : null;
  const go = (pathname: Place) => router.push({ pathname, params: { cwd } });
  const title = archived ? 'Archived' : name || cwd.split('/').pop() || cwd;

  const terminal = () =>
    post<{ name: string }>('/terms', { cwd }).then((r) => router.push({ pathname: '/term/[name]', params: { name: r.name, cwd } }), (e) => alert('Could not open a terminal', e.message));

  const header = (
    <View style={{ gap: space.md, paddingBottom: space.xs }}>
      <View style={{ paddingHorizontal: space.xs }}>
        <Text variant="largeTitle" numberOfLines={1} accessibilityRole="header">{title}</Text>
        <Text variant="footnote" numberOfLines={1}>{home(cwd)}</Text>
      </View>
      {searchField}
      {!needle && !archived && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          <Action icon="square.and.pencil" label="New Thread" tint={color.accent} onPress={() => go('/new')} />
          <Action icon="folder" label="Files" tint={color.blue} onPress={() => go('/files')} />
          <Action icon="arrow.triangle.branch" label="Changes" tint={color.green} onPress={() => go('/git')} />
          <Action icon="globe" label="Preview" tint={color.text} onPress={() => go('/preview')} />
        </View>
      )}
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title, headerTitle: '', headerSearchBarOptions }} />
      <HeaderActions
        actions={[
          { icon: 'terminal', label: 'Open Terminal', onPress: terminal },
          {
            icon: 'ellipsis',
            label: 'More',
            menu: [
              { title: 'Files', icon: 'folder', onPress: () => go('/files') },
              { title: 'Changes', icon: 'arrow.triangle.branch', onPress: () => go('/git') },
              { title: 'Preview Dev Server', icon: 'globe', onPress: () => go('/preview') },
              { title: 'Instructions', icon: 'text.book.closed', onPress: () => go('/instructions') },
              { title: 'Schedule a Run', icon: 'calendar.badge.plus', onPress: () => go('/schedule') },
              { title: 'Compare Agents', icon: 'square.on.square', onPress: () => go('/compares') },
              { title: 'Show Archived', icon: 'archivebox', on: archived, onPress: () => setArchived((a) => !a) },
            ],
          },
          { icon: 'square.and.pencil', label: 'New Thread', onPress: () => go('/new') },
        ]}
      />
      <ListScreen
        data={shown}
        error={error}
        pull={pull}
        keyExtractor={(s) => s.provider + s.id}
        header={header}
        empty={
          needle ? (
            <EmptyState icon="magnifyingglass" title={`No results for “${q.trim()}”`} message="Try another word from the title or the first message." />
          ) : archived ? (
            <EmptyState icon="archivebox" title="Nothing archived" message="Archive a conversation from its long-press menu to tuck it away." />
          ) : (
            <EmptyState icon="bubble.left.and.bubble.right" title="No conversations yet" message="Start one, and it runs right here on your Mac." action={<Button variant="primary" icon="square.and.pencil" label="New Thread" onPress={() => go('/new')} />} />
          )
        }
        renderItem={({ item: s, index }) => (
          <>
            {index === 0 && running.length > 0 && <SectionHeader title="Running Now" />}
            {index === running.length && <SectionHeader title={archived ? 'Archived' : 'Conversations'} trailing={<Text variant="footnote">{rest.length}</Text>} />}
            <SessionRow s={s} onChange={load} />
          </>
        )}
      />
    </>
  );
}

function Action({ icon, label, tint, onPress }: { icon: IconName; label: string; tint: string; onPress: () => void }) {
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={{ width: '48%', flexGrow: 1 }}>
      <Surface style={{ padding: space.md + 2, gap: space.lg, borderRadius: radius.card }}>
        <Icon name={icon} size={20} color={tint} />
        <Text variant="callout" weight="medium">{label}</Text>
      </Surface>
    </Press>
  );
}

export function SessionRow({ s, onChange, showDir }: { s: Session; onChange: () => void; showDir?: boolean }) {
  const { color } = useTheme();
  const open = () => (s.live ? router.push({ pathname: '/thread/[id]', params: { id: s.live, cwd: s.cwd } }) : openThread({ provider: s.provider, cwd: s.cwd, resume: s.id }));
  const meta = [agentName(s.provider), ago(s.lastActive), showDir ? s.cwd.split('/').pop() : '', s.preview && s.preview !== s.title ? s.preview : ''].filter(Boolean).join(' · ');
  const badges = s.live || s.busy || !!s.worktree;
  return (
    <ListItem
      leading={<AgentTile p={s.provider} />}
      title={s.title || 'Untitled conversation'}
      subtitle={meta}
      subtitleLines={2}
      trailing={
        badges ? (
          <View style={{ alignItems: 'flex-end', gap: space.xs }}>
            {s.live ? <Pill label="Live" tone="success" live /> : s.busy ? <Pill label="In Terminal" tone="warning" /> : null}
            {!!s.worktree && <Pill label={s.worktree.replace(/^luther\//, '')} tone="info" icon="arrow.triangle.branch" />}
          </View>
        ) : (
          <Icon name={s.pinned ? 'pin.fill' : 'chevron.right'} size={s.pinned ? 12 : 13} color={s.pinned ? color.accent : color.faint} />
        )
      }
      onPress={open}
      menu={sessionActions(s)}
      onMenu={(id) => onSessionAction(id, s, open, onChange)}
    />
  );
}
