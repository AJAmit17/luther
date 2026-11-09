import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Linking, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { api, del, post } from '@/lib/hosts';
import type { GitStatus, Repository } from '@/lib/protocol';
import { Button, Icon, Note, Row, c, card, mono, tint, type, useLoad, listStyle, useHex } from '@/components/ui';
import { openThread } from '@/lib/threads';
import { tb } from '@/components/toolbar-icon';

const label: Record<string, string> = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', '?': 'new', U: 'conflict' };

// Uncommitted changes in the project: tap a file for its diff, commit everything.
export default function Git() {
  useHex();
  const { cwd } = useLocalSearchParams<{ cwd: string }>();
  const { data, error, pull } = useLoad(() => api<Repository[]>('/git/repos?cwd=' + encodeURIComponent(cwd)), [cwd]);
  const [selected, setSelected] = useState<string | null>(null);
  const repo = data?.find((r) => r.cwd === selected) ?? (data?.length === 1 ? data[0] : null);
  if (repo) return <RepositoryChanges key={repo.cwd} cwd={repo.cwd} name={repo.name} back={data && data.length > 1 ? () => setSelected(null) : undefined} />;
  return (
    <FlatList
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={listStyle}
      contentInsetAdjustmentBehavior="automatic"
      data={data ?? []}
      keyExtractor={(r) => r.cwd}
      refreshControl={<RefreshControl {...pull} />}
      ListHeaderComponent={<><Stack.Screen options={{ title: 'Repositories' }} />{error ? <Note error>{error}</Note> : <Note>Choose a repository. Git actions only affect the selected checkout.</Note>}</>}
      ListEmptyComponent={data ? <Note>No repositories found. Choose a folder containing git checkouts (up to four levels deep).</Note> : undefined}
      renderItem={({ item: r }) => <Row icon={<Icon name="arrow.triangle.branch" color={c.blue} />} title={r.name} sub={r.error || `${r.branch || 'Detached HEAD'} · ${r.changes ? `${r.changes} changed files` : 'Clean'}`} onPress={() => setSelected(r.cwd)} />}
    />
  );
}

function RepositoryChanges({ cwd, name, back }: { cwd: string; name: string; back?: () => void }) {
  useHex();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { data, error, load, pull } = useLoad(() => api<GitStatus>('/git/status?cwd=' + encodeURIComponent(cwd)), [cwd]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false);
  const conflicts = (data?.files ?? []).filter((f) => f.status.includes('U') || f.status === 'AA' || f.status === 'DD');

  // A commit message written from the diff by a quick model call.
  const write = () => {
    setWriting(true);
    post<{ subject: string; body: string }>('/git/message', { cwd })
      .then((m) => setMsg(m.body ? `${m.subject}\n\n${m.body}` : m.subject), (e) => Alert.alert('Couldn’t write a message', e.message))
      .finally(() => setWriting(false));
  };
  const resolve = () =>
    openThread(
      { provider: 'claude', cwd, mode: 'edits' },
      false,
      `A ${data?.operation ?? 'merge'} stopped with conflicts in: ${conflicts.map((f) => f.path).join(', ')}. Resolve each one, keeping what both sides meant to do, remove the conflict markers, and run the tests if there are any. Stage the resolved files with git add, but don't commit or continue the ${data?.operation ?? 'merge'}: I'll review first.`,
    );
  const abort = () =>
    Alert.alert(`Abort the ${data?.operation}?`, 'Everything goes back to how it was before it started.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Abort', style: 'destructive', onPress: () => run('Abort', post('/git/abort', { cwd })) },
    ]);
  const bring = () =>
    Alert.alert('Bring these changes to the main checkout?', 'They’re applied there as uncommitted changes. Nothing is applied if they clash with what’s there.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Bring', onPress: () => run('Bring', post('/git/worktree/bring', { cwd }), () => Alert.alert('Done', 'The changes are in the main checkout now, uncommitted.')) },
    ]);

  const commit = () => {
    setBusy(true);
    post<{ output: string }>('/git/commit', { cwd, message: msg.trim() })
      .then((r) => { setMsg(''); load(); Alert.alert('Committed', r.output.split('\n')[0]); }, (e) => Alert.alert('Commit failed', e.message))
      .finally(() => setBusy(false));
  };

  const run = (what: string, p: Promise<unknown>, done?: (r: any) => void) => {
    setBusy(true);
    p.then((r) => { load(); done?.(r); }, (e) => Alert.alert(`${what} failed`, e.message)).finally(() => setBusy(false));
  };
  const push = () => run('Push', post<{ output: string }>('/git/push', { cwd }), (r) => Alert.alert('Pushed', r.output.split('\n').pop()));
  const pr = () =>
    Alert.prompt('Open a pull request', `Pushes ${data?.branch ?? 'this branch'} and opens a PR with the Mac's gh login.`, (title) =>
      title.trim() && run('Pull request', post<{ url: string }>('/git/pr', { cwd, title }), (r) => Linking.openURL(r.url)),
    );
  const removeWorktree = (force = false) =>
    Alert.alert(force ? 'Remove it anyway?' : 'Remove this worktree?', force ? 'Uncommitted changes in it are lost.' : `The checkout and its branch ${data?.branch ?? ''} are deleted. Bring its changes to the main checkout first if you want them.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          del(`/git/worktree?cwd=${encodeURIComponent(cwd)}&branch=1${force ? '&force=1' : ''}`).then(
            () => router.dismissAll(),
            (e) => (force ? Alert.alert('Remove failed', e.message) : removeWorktree(true)),
          ),
      },
    ]);
  const sync = data && (data.upstream ? (data.ahead ? `${data.ahead} commit${data.ahead === 1 ? '' : 's'} ahead of ${data.upstream}` : `Up to date with ${data.upstream}`) : data.branch ? 'Not pushed yet' : '');

  return (
    <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={headerHeight} style={{ flex: 1, backgroundColor: c.bg as any }}>
      <Stack.Screen options={{ title: data?.branch ? `${name} · ${data.branch}` : name }} />
      <Stack.Toolbar placement="right">
        {back ? <Stack.Toolbar.Button icon={tb('square.grid.2x2')} onPress={back} /> : null}
        <Stack.Toolbar.Menu icon={tb('ellipsis.circle')}>
          <Stack.Toolbar.MenuAction icon={tb('doc.text.magnifyingglass')} onPress={() => router.push({ pathname: '/diff', params: { cwd } })}>All diffs</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon={tb('arrow.up.circle')} disabled={busy} onPress={push}>Push</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon={tb('arrow.triangle.pull')} disabled={busy} onPress={pr}>Create pull request</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon={tb('arrow.triangle.branch')} onPress={() => router.push({ pathname: '/branches', params: { cwd } })}>Branches and stashes</Stack.Toolbar.MenuAction>
          {data?.worktree ? (
            <Stack.Toolbar.MenuAction icon={tb('tray.and.arrow.down')} disabled={busy || !data.files.length} onPress={bring}>Bring to main checkout</Stack.Toolbar.MenuAction>
          ) : (
            <Stack.Toolbar.MenuAction icon={tb('square.on.square')} onPress={() => router.push({ pathname: '/worktrees', params: { cwd } })}>Worktrees</Stack.Toolbar.MenuAction>
          )}
          {data?.worktree ? (
            <Stack.Toolbar.MenuAction icon={tb('trash')} destructive onPress={() => removeWorktree()}>Remove worktree</Stack.Toolbar.MenuAction>
          ) : null}
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <FlatList
        contentContainerStyle={listStyle}
        style={{ flex: 1, backgroundColor: c.bg as any }}
        contentInsetAdjustmentBehavior="automatic"
        data={data?.files ?? []}
        keyExtractor={(f) => f.path}
        refreshControl={<RefreshControl {...pull} />}
        ListHeaderComponent={
          error ? (
            <Note error>{error}</Note>
          ) : (
            <View style={{ gap: 8 }}>
              {!!data?.operation && (
                <View style={[card, { padding: 13, gap: 10, borderColor: c.warn }]}>
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    <Icon name="exclamationmark.triangle.fill" size={15} color={c.warn} />
                    <Text style={[type.subhead, { fontWeight: '600', flex: 1 }]}>
                      {`The ${data.operation} stopped${conflicts.length ? ` with ${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'}` : ''}`}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {!!conflicts.length && <Chip icon="sparkles" label="Resolve with an agent" onPress={resolve} accent />}
                    <Chip icon="xmark.circle" label={`Abort ${data.operation}`} onPress={abort} />
                  </View>
                </View>
              )}
              {!!sync && <Note>{sync}{data?.worktree ? ' · Luther worktree' : ''}</Note>}
            </View>
          )
        }
        ListEmptyComponent={data ? <Note>Nothing to commit. Working tree clean.</Note> : undefined}
        renderItem={({ item: f }) => {
          const k = (f.status.trim()[0] ?? '?') as string;
          return (
            <Row
              icon={<Icon name={k === 'D' ? 'minus.circle' : k === '?' || k === 'A' ? 'plus.circle' : 'pencil.circle'} color={k === 'D' ? c.red : k === '?' || k === 'A' ? c.green : c.accent} />}
              title={f.path.split('/').pop()!}
              sub={`${f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) + ' · ' : ''}${label[k] ?? f.status}`}
              onPress={() => router.push({ pathname: '/diff', params: { cwd, path: f.path } })}
            />
          );
        }}
      />
      {!!data?.files.length && (
        <View style={{ flexDirection: 'row', gap: 8, padding: 10, paddingBottom: Math.max(insets.bottom, 10), borderTopWidth: 0.5, borderColor: c.line as any }}>
          <TextInput
            style={{ flex: 1, color: c.text, backgroundColor: c.card, borderRadius: 12, padding: 11, fontFamily: mono, fontSize: 13, maxHeight: 120 }}
            value={msg}
            onChangeText={setMsg}
            multiline
            placeholder="Commit message"
            placeholderTextColor={c.dim}
          />
          <Pressable onPress={write} disabled={writing} accessibilityLabel="Write the message for me" style={{ justifyContent: 'center', paddingHorizontal: 6 }}>
            {writing ? <ActivityIndicator /> : <Icon name="sparkles" size={20} color={c.accent} />}
          </Pressable>
          <Button kind="accent" label="Commit all" disabled={!msg.trim() || busy} onPress={commit} />
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function Chip({ icon, label, onPress, accent }: { icon: string; label: string; onPress: () => void; accent?: boolean }) {
  useHex();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: tint(accent ? 'accent' : 'text', pressed ? 0.2 : 0.08) })}>
      <Icon name={icon} size={13} color={accent ? c.accent : c.text} />
      <Text style={[type.footnote, { fontWeight: '600', color: accent ? c.accent : c.text }]}>{label}</Text>
    </Pressable>
  );
}
