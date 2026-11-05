import { useEffect, useState } from 'react';
import { Alert, FlatList, RefreshControl, SectionList } from 'react-native';
import { Redirect, Stack, router } from 'expo-router';
import { api, currentHost, del, hosts, routeInUse, setCurrent, type Host } from '@/lib/hosts';
import type { Project, Session, Term, ThreadInfo } from '@/lib/protocol';
import { SessionRow } from '@/components/project-screen';
import { requestNotificationPermission } from '@/lib/notifier';
import { Badge, Icon, Note, ProviderIcon, Row, Section, ago, c, home, providerName, useLoad } from '@/components/ui';

type Item = { thread: ThreadInfo } | { term: Term } | { project: Project };

// Home: what's running on the current Mac, then its projects.
export default function Home() {
  const [host, setHost] = useState<Host | null | undefined>(undefined);
  const [all, setAll] = useState<Host[]>([]);
  useEffect(() => {
    currentHost().then((h) => {
      setHost(h);
      if (h) void requestNotificationPermission();
    });
    hosts().then(setAll);
  }, []);
  const { data, error, loading, load } = useLoad(
    () => Promise.all([api<ThreadInfo[]>('/threads'), api<Term[]>('/terms'), api<Project[]>('/projects')]),
    [host?.id],
  );
  const [open, terms, projects] = data ?? [[], [], []];
  const [q, setQ] = useState('');
  const found = useLoad(() => (q ? api<Session[]>('/sessions?q=' + encodeURIComponent(q)) : Promise.resolve([])), [host?.id, q]);

  const switchTo = async (h: Host) => {
    await setCurrent(h.id);
    setHost(h);
  };
  const stop = (what: string, body: string, path: string) =>
    Alert.alert(`Stop ${what}?`, body, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Stop', style: 'destructive', onPress: () => del(path).then(load, (e) => Alert.alert('Error', e.message)) },
    ]);

  if (host === null) return <Redirect href="/pair" />;
  const running: Item[] = [...open.map((thread) => ({ thread })), ...terms.map((term) => ({ term }))];
  const route = routeInUse(host ?? null);
  return (
    <>
      <Stack.Screen
        options={{
          title: host?.name ?? 'Luther',
          headerSearchBarOptions: {
            placeholder: 'Search all conversations',
            onSearchButtonPress: (e) => setQ(e.nativeEvent.text.trim()),
            onChangeText: (e) => !e.nativeEvent.text && setQ(''),
            onCancelButtonPress: () => setQ(''),
          },
        }}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="desktopcomputer">
          <Stack.Toolbar.Menu inline title="Macs">
            {all.map((h) => (
              <Stack.Toolbar.MenuAction key={h.id} isOn={h.id === host?.id} onPress={() => switchTo(h)}>{h.name}</Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
          <Stack.Toolbar.MenuAction icon="plus" onPress={() => router.push('/pair')}>Pair another Mac</Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.Button icon="folder.badge.plus" onPress={() => router.push('/browse')} />
        <Stack.Toolbar.Button icon="gearshape" onPress={() => router.push('/settings')} />
      </Stack.Toolbar>
      {q ? (
        <FlatList
          style={{ flex: 1, backgroundColor: c.bg as any }}
          contentInsetAdjustmentBehavior="automatic"
          data={found.data ?? []}
          keyExtractor={(s) => s.provider + s.id}
          ListHeaderComponent={found.error ? <Note error>{found.error}</Note> : undefined}
          ListEmptyComponent={found.data && !found.loading ? <Note>No conversation mentions “{q}”.</Note> : undefined}
          renderItem={({ item }) => <SessionRow s={item} onChange={found.load} showDir />}
        />
      ) : (
      <SectionList<Item>
        style={{ flex: 1, backgroundColor: c.bg as any }}
        contentInsetAdjustmentBehavior="automatic"
        sections={[
          ...(running.length ? [{ title: 'Running now', data: running }] : []),
          { title: route ? `Projects · ${route.includes('.ts.net') ? 'tailnet' : 'tunnel'}` : 'Projects', data: projects.map((project) => ({ project })) },
        ]}
        keyExtractor={(x) => ('thread' in x ? x.thread.id : 'term' in x ? x.term.name : x.project.cwd)}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListHeaderComponent={error ? <Note error>{error}</Note> : undefined}
        ListEmptyComponent={data ? <Note>No projects yet. Tap the folder button to start an agent anywhere in your home folder.</Note> : undefined}
        renderSectionHeader={({ section }) => <Section title={section.title} />}
        stickySectionHeadersEnabled={false}
        renderItem={({ item }) => {
          if ('thread' in item) {
            const t = item.thread;
            return (
              <Row
                icon={<ProviderIcon p={t.provider} />}
                title={t.title || `${providerName(t.provider)} · ${t.cwd.split('/').pop()}`}
                sub={`${home(t.cwd)} · ${t.busy ? t.activity || 'Working…' : 'idle'}${t.clients ? ` · ${t.clients} watching` : ''}`}
                right={<Badge label={t.busy ? 'working' : 'live'} color={t.busy ? c.accent : c.green} />}
                onPress={() => router.push({ pathname: '/thread/[id]', params: { id: t.id, cwd: t.cwd } })}
                onLongPress={() => stop('this thread', 'The agent stops after the current turn. The conversation is saved; resume it from its project.', '/threads/' + encodeURIComponent(t.id))}
              />
            );
          }
          if ('term' in item) {
            const t = item.term;
            return (
              <Row
                icon={<Icon name="terminal" size={22} color={c.dim} />}
                title={`Terminal · ${t.cwd.split('/').pop()}`}
                sub={`${home(t.cwd)} · ${ago(t.created * 1000)}${t.attached ? ' · open on the Mac' : ''}`}
                onPress={() => router.push({ pathname: '/term/[name]', params: { name: t.name, cwd: t.cwd } })}
                onLongPress={() => stop('this terminal', 'The shell and anything running in it stop.', '/terms/' + encodeURIComponent(t.name))}
              />
            );
          }
          const p = item.project;
          return (
            <Row
              icon={<Icon name="folder" size={22} color={c.blue} />}
              title={p.name}
              sub={`${home(p.cwd)}${p.sessions ? ` · ${p.sessions} conversations` : ''}${p.lastActive && p.sessions ? ' · ' + ago(p.lastActive) : ''}`}
              right={p.live ? <Badge label={`${p.live} live`} color={c.green} /> : <Icon name="chevron.right" size={13} color={c.faint} />}
              onPress={() => router.push({ pathname: '/project', params: { cwd: p.cwd, name: p.name } })}
            />
          );
        }}
      />
      )}
    </>
  );
}
