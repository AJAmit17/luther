import { useEffect, useMemo, useState } from 'react';
import { Alert, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Redirect, Stack, router } from 'expo-router';
import { api, currentHost, del, hosts, keyFor, onHostsChange, routeInUse, setCurrent, type Host } from '@/lib/hosts';
import type { Project, Session, Term, ThreadInfo } from '@/lib/protocol';
import { SessionRow } from '@/components/project-screen';
import { requestNotificationPermission } from '@/lib/notifier';
import { updateWidgets } from '@/lib/widgets';
import { Empty, Icon, IconTile, Note, Pill, ProviderIcon, Row, SectionTitle, ago, c, home, listStyle, providerName, type, useLoad, useHex, searchColors } from '@/components/ui';
import { tb } from '@/components/toolbar-icon';

const threadTitle = (t: ThreadInfo) => t.title || `${providerName(t.provider)} · ${t.cwd.split('/').pop()}`;

function ThreadRow({ t, onStop }: { t: ThreadInfo; onStop: () => void }) {
  const waiting = t.activity === 'Waiting for you';
  return (
    <Row
      icon={<ProviderIcon p={t.provider} />}
      title={threadTitle(t)}
      sub={t.busy ? t.activity || 'Working…' : `${home(t.cwd)}${t.clients ? ` · ${t.clients} watching` : ''}`}
      subLines={1}
      right={waiting ? <Pill label="Needs you" tone="warn" icon="hand.raised.fill" /> : t.busy ? <Pill label="Working" tone="accent" live /> : <Pill label="Ready" tone="green" />}
      onPress={() => router.push({ pathname: '/thread/[id]', params: { id: t.id, cwd: t.cwd } })}
      menu={[
        { id: 'open', title: 'Open', image: 'arrow.up.right' },
        { id: 'stop', title: 'Stop agent', image: 'stop.circle', attributes: { destructive: true } },
      ]}
      onMenu={(id) => (id === 'stop' ? onStop() : router.push({ pathname: '/thread/[id]', params: { id: t.id, cwd: t.cwd } }))}
    />
  );
}

function ProjectRow({ p }: { p: Project }) {
  useHex();
  const open = (pathname: '/project' | '/new' | '/files' | '/git' | '/preview' | '/schedule') => router.push({ pathname, params: { cwd: p.cwd, name: p.name } });
  return (
    <Row
      icon={<IconTile name="folder.fill" color={c.blue} />}
      title={p.name}
      sub={[home(p.cwd), p.sessions ? `${p.sessions} conversation${p.sessions === 1 ? '' : 's'}` : '', p.sessions && p.lastActive ? ago(p.lastActive) : ''].filter(Boolean).join(' · ')}
      subLines={1}
      right={p.live ? <Pill label={`${p.live} live`} tone="green" /> : <Icon name="chevron.right" size={13} color={c.faint} />}
      onPress={() => open('/project')}
      menu={[
        { id: '/new', title: 'New thread', image: 'square.and.pencil' },
        { id: '/files', title: 'Files', image: 'folder' },
        { id: '/git', title: 'Changes', image: 'arrow.triangle.branch' },
        { id: '/preview', title: 'Preview dev server', image: 'globe' },
        { id: '/schedule', title: 'Schedule a run', image: 'calendar.badge.plus' },
      ]}
      onMenu={(id) => open(id as '/new')}
    />
  );
}

// The current Mac: what's running on it now, then its projects.
export default function Home() {
  useHex();
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
  // Header options built once: rebuilding them each render re-applies the native
  // search bar, and a large title set after first layout overlaps it.
  const hx = useHex();
  const search = useMemo(
    () => ({
      ...searchColors(hx),
      placeholder: 'Search all conversations',
      onSearchButtonPress: (e: { nativeEvent: { text: string } }) => setQ(e.nativeEvent.text.trim()),
      onChangeText: (e: { nativeEvent: { text: string } }) => !e.nativeEvent.text && setQ(''),
      onCancelButtonPress: () => setQ(''),
    }),
    [hx],
  );

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
  if (host === undefined) return null; // first layout only once the title is known
  const route = routeInUse(host ?? null);
  const via = route ? (route.includes('.ts.net') ? 'tailnet' : 'Cloudflare tunnel') : '';

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={listStyle}
      keyboardDismissMode="on-drag"
      refreshControl={<RefreshControl {...(q ? found.pull : pull)} />}
    >
      <Stack.Screen
        options={{ title: host.name, headerSearchBarOptions: search }}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon={tb('desktopcomputer')}>
          <Stack.Toolbar.Menu inline title="Macs">
            {all.map((h) => (
              <Stack.Toolbar.MenuAction key={h.id} isOn={h.id === host?.id} onPress={() => switchTo(h)}>{h.name}</Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
          <Stack.Toolbar.MenuAction icon={tb('plus')} onPress={() => router.push('/pair')}>Pair another Mac</Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.Button icon={tb('square.and.pencil')} onPress={() => router.push('/browse')} />
      </Stack.Toolbar>

      {q ? (
        <>
          {!!found.error && <Note error>{found.error}</Note>}
          {found.data?.map((s) => <SessionRow key={s.provider + s.id} s={s} onChange={found.load} showDir />)}
          {found.data && !found.data.length && !found.loading && <Empty icon="magnifyingglass" title={`No results for “${q}”`} sub="Titles, first messages and folders are searched." />}
        </>
      ) : (
        <>
          {!!error && <Note error>{error}</Note>}
          {(open.length > 0 || terms.length > 0) && <SectionTitle>Running now</SectionTitle>}
          {open.map((t) => (
            <ThreadRow key={t.id} t={t} onStop={() => stop('this agent', 'It stops after the current turn. The conversation is saved; resume it from its project.', '/threads/' + encodeURIComponent(t.id))} />
          ))}
          {terms.map((t) => (
            <Row
              key={t.name}
              icon={<IconTile name="terminal.fill" color={c.dim} />}
              title={`Terminal · ${t.cwd.split('/').pop()}`}
              sub={`${home(t.cwd)} · ${ago(t.created * 1000)}${t.attached ? ' · open on the Mac' : ''}`}
              subLines={1}
              onPress={() => router.push({ pathname: '/term/[name]', params: { name: t.name, cwd: t.cwd } })}
              menu={[{ id: 'stop', title: 'Stop terminal', image: 'xmark.circle', attributes: { destructive: true } }]}
              onMenu={() => stop('this terminal', 'The shell and anything running in it stop.', '/terms/' + encodeURIComponent(t.name))}
            />
          ))}
          {projects.length > 0 && <SectionTitle>Projects</SectionTitle>}
          {projects.map((p) => <ProjectRow key={p.cwd} p={p} />)}
          {data && !projects.length && !open.length && (
            <Empty icon="folder.badge.plus" title="No projects yet" sub="Start an agent in any folder of your home folder; its conversations collect here." />
          )}
          {!!host && (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 14 }}>
              <Icon name={keyFor(host) ? 'lock.fill' : 'lock.open'} size={11} color={keyFor(host) ? c.green : c.faint} />
              <Text style={type.caption}>
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
