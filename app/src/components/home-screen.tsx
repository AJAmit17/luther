import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Redirect, Stack, router } from 'expo-router';
import { api, currentHost, del, hosts, keyFor, onHostsChange, routeInUse, setCurrent, type Host } from '@/lib/hosts';
import type { Project, Session, Term, ThreadInfo } from '@/lib/protocol';
import { SessionRow } from '@/components/project-screen';
import { requestNotificationPermission } from '@/lib/notifier';
import { updateWidgets } from '@/lib/widgets';
import { EmptyState, HeaderActions, Icon, LargeTitle, ListItem, Note, Pill, SectionHeader, SkeletonList, Text, Tile, alert, space, useHeaderSearch, useTheme } from '@/design';
import { AgentTile, agentName } from '@/features/agents';
import { ago, home } from '@/lib/format';
import { useLoad } from '@/lib/use-load';

const threadTitle = (t: ThreadInfo) => t.title || `${agentName(t.provider)} · ${t.cwd.split('/').pop()}`;

function ThreadRow({ t, onStop }: { t: ThreadInfo; onStop: () => void }) {
  const waiting = t.activity === 'Waiting for you';
  return (
    <ListItem
      leading={<AgentTile p={t.provider} />}
      title={threadTitle(t)}
      subtitle={t.busy ? t.activity || 'Working…' : `${home(t.cwd)}${t.clients ? ` · ${t.clients} watching` : ''}`}
      trailing={waiting ? <Pill label="Needs you" tone="warning" icon="hand.raised.fill" /> : t.busy ? <Pill label="Working" tone="accent" live /> : <Pill label="Ready" tone="success" />}
      onPress={() => router.push({ pathname: '/thread/[id]', params: { id: t.id, cwd: t.cwd } })}
      menu={[
        { id: 'open', title: 'Open', image: 'arrow.up.right' },
        { id: 'stop', title: 'Stop Agent', image: 'stop.circle', attributes: { destructive: true } },
      ]}
      onMenu={(id) => (id === 'stop' ? onStop() : router.push({ pathname: '/thread/[id]', params: { id: t.id, cwd: t.cwd } }))}
    />
  );
}

function ProjectRow({ p }: { p: Project }) {
  const { color } = useTheme();
  const open = (pathname: '/project' | '/new' | '/files' | '/git' | '/preview' | '/schedule') => router.push({ pathname, params: { cwd: p.cwd, name: p.name } });
  return (
    <ListItem
      leading={<Tile icon="folder.fill" color={color.blue} />}
      title={p.name}
      subtitle={[home(p.cwd), p.sessions ? `${p.sessions} conversation${p.sessions === 1 ? '' : 's'}` : '', p.sessions && p.lastActive ? ago(p.lastActive) : ''].filter(Boolean).join(' · ')}
      trailing={p.live ? <Pill label={`${p.live} live`} tone="success" /> : <Icon name="chevron.right" size={13} color={color.faint} />}
      onPress={() => open('/project')}
      menu={[
        { id: '/new', title: 'New Thread', image: 'square.and.pencil' },
        { id: '/files', title: 'Files', image: 'folder' },
        { id: '/git', title: 'Changes', image: 'arrow.triangle.branch' },
        { id: '/preview', title: 'Preview Dev Server', image: 'globe' },
        { id: '/schedule', title: 'Schedule a Run', image: 'calendar.badge.plus' },
      ]}
      onMenu={(id) => open(id as '/new')}
    />
  );
}

// The current Mac: what's running on it now, then its projects.
export default function Home() {
  const { color } = useTheme();
  const [host, setHost] = useState<Host | null | undefined>(undefined);
  const [all, setAll] = useState<Host[]>([]);
  useEffect(() => {
    const sync = () => {
      currentHost().then((h) => {
        setHost(h);
        if (h) void requestNotificationPermission();
      });
      hosts().then(setAll);
    };
    sync();
    return onHostsChange(sync); // pairing or switching Macs elsewhere
  }, []);
  const { data, error, load, pull } = useLoad(
    () => Promise.all([api<ThreadInfo[]>('/threads'), api<Term[]>('/terms'), api<Project[]>('/projects')]),
    [host?.id],
    'home',
  );
  const [open, terms, projects] = data ?? [[], [], []];
  useEffect(() => {
    if (!data || !host) return;
    updateWidgets({
      mac: host.name,
      threads: open.map((t) => ({ id: t.id, title: threadTitle(t), cwd: t.cwd, busy: t.busy, activity: t.activity })),
      projects: projects.slice(0, 8).map((p) => ({ name: p.name, cwd: p.cwd })),
    });
  }, [data, host]); // eslint-disable-line react-hooks/exhaustive-deps
  const [q, setQ] = useState('');
  const found = useLoad(() => (q ? api<Session[]>('/sessions?q=' + encodeURIComponent(q)) : Promise.resolve([])), [host?.id, q]);
  const { headerSearchBarOptions, field: searchField } = useHeaderSearch({ placeholder: 'Search all conversations', onChange: setQ });

  const switchTo = async (h: Host) => {
    await setCurrent(h.id);
    setHost(h);
  };
  const stop = (what: string, body: string, path: string) =>
    alert(`Stop ${what}?`, body, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Stop', style: 'destructive', onPress: () => del(path).then(load, (e) => alert('Error', e.message)) },
    ]);

  if (host === null) return <Redirect href="/pair" />;
  if (host === undefined) return null; // first layout only once the title is known
  const route = routeInUse(host ?? null);
  const via = route ? (route.includes('.ts.net') ? 'tailnet' : 'Cloudflare tunnel') : '';

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: color.bg }}
      contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: space.xxl + space.sm }}
      keyboardDismissMode="on-drag"
      refreshControl={<RefreshControl {...(q ? found.pull : pull)} />}
    >
      <Stack.Screen
        options={{ title: host.name, headerSearchBarOptions }}
      />
      <LargeTitle>{host.name}</LargeTitle>
      {searchField}
      <HeaderActions
        actions={[
          {
            icon: 'desktopcomputer',
            label: 'Macs',
            menu: [
              { section: 'Macs', items: all.map((h) => ({ title: h.name, on: h.id === host?.id, onPress: () => switchTo(h) })) },
              { title: 'Pair Another Mac', icon: 'plus', onPress: () => router.push('/pair') },
            ],
          },
          { icon: 'square.and.pencil', label: 'New Conversation', onPress: () => router.push('/browse') },
        ]}
      />

      {q ? (
        <>
          {!!found.error && <Note tone="danger">{found.error}</Note>}
          {found.data?.map((s) => <SessionRow key={s.provider + s.id} s={s} onChange={found.load} showDir />)}
          {found.data && !found.data.length && !found.loading && <EmptyState icon="magnifyingglass" title={`No results for “${q}”`} message="Titles, first messages and folders are searched." />}
        </>
      ) : (
        <>
          {!!error && <Note tone="danger">{error}</Note>}
          {(open.length > 0 || terms.length > 0 || (!data && !error)) && <SectionHeader title="Running now" />}
          {!data && !error && <SkeletonList />}
          {open.map((t) => (
            <ThreadRow key={t.id} t={t} onStop={() => stop('this agent', 'It stops after the current turn. The conversation is saved; resume it from its project.', '/threads/' + encodeURIComponent(t.id))} />
          ))}
          {terms.map((t) => (
            <ListItem
              key={t.name}
              leading={<Tile icon="terminal.fill" color={color.dim} />}
              title={`Terminal · ${t.cwd.split('/').pop()}`}
              subtitle={`${home(t.cwd)} · ${ago(t.created * 1000)}${t.attached ? ' · open on the Mac' : ''}`}
              onPress={() => router.push({ pathname: '/term/[name]', params: { name: t.name, cwd: t.cwd } })}
              menu={[{ id: 'stop', title: 'Stop Terminal', image: 'xmark.circle', attributes: { destructive: true } }]}
              onMenu={() => stop('this terminal', 'The shell and anything running in it stop.', '/terms/' + encodeURIComponent(t.name))}
            />
          ))}
          {projects.length > 0 && <SectionHeader title="Projects" />}
          {projects.map((p) => <ProjectRow key={p.cwd} p={p} />)}
          {data && !projects.length && !open.length && (
            <EmptyState icon="folder.badge.plus" title="No projects yet" message="Start an agent in any folder of your home folder; its conversations collect here." />
          )}
          {!!host && (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs + 2, paddingTop: space.md + 2 }}>
              <Icon name={keyFor(host) ? 'lock.fill' : 'lock.open'} size={11} color={keyFor(host) ? color.green : color.faint} />
              <Text variant="caption">
                {via ? `Connected over ${via}` : 'Not connected'}
                {keyFor(host) ? ' · end-to-end encrypted' : ''}
              </Text>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}
