import { useState } from 'react';
import { Alert, FlatList, Linking, RefreshControl, TextInput, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, del, post } from '@/lib/hosts';
import type { GitStatus } from '@/lib/protocol';
import { Button, Icon, Note, Row, c, mono, useLoad } from '@/components/ui';

const label: Record<string, string> = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', '?': 'new', U: 'conflict' };

// Uncommitted changes in the project: tap a file for its diff, commit everything.
export default function Git() {
  const { cwd } = useLocalSearchParams<{ cwd: string }>();
  const insets = useSafeAreaInsets();
  const { data, error, loading, load } = useLoad(() => api<GitStatus>('/git/status?cwd=' + encodeURIComponent(cwd)), [cwd]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

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
    Alert.alert(force ? 'Remove it anyway?' : 'Remove this worktree?', force ? 'Uncommitted changes in it are lost.' : `The checkout is deleted; the branch ${data?.branch ?? ''} stays in the repo.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          del(`/git/worktree?cwd=${encodeURIComponent(cwd)}${force ? '&force=1' : ''}`).then(
            () => router.dismissAll(),
            (e) => (force ? Alert.alert('Remove failed', e.message) : removeWorktree(true)),
          ),
      },
    ]);
  const sync = data && (data.upstream ? (data.ahead ? `${data.ahead} commit${data.ahead === 1 ? '' : 's'} ahead of ${data.upstream}` : `Up to date with ${data.upstream}`) : data.branch ? 'Not pushed yet' : '');

  return (
    <>
      <Stack.Screen options={{ title: data?.branch ? `Changes · ${data.branch}` : 'Changes' }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis.circle">
          <Stack.Toolbar.MenuAction icon="doc.text.magnifyingglass" onPress={() => router.push({ pathname: '/diff', params: { cwd } })}>All diffs</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="arrow.up.circle" disabled={busy} onPress={push}>Push</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="arrow.triangle.pull" disabled={busy} onPress={pr}>Create pull request</Stack.Toolbar.MenuAction>
          {data?.worktree ? (
            <Stack.Toolbar.MenuAction icon="trash" destructive onPress={() => removeWorktree()}>Remove worktree</Stack.Toolbar.MenuAction>
          ) : null}
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <FlatList
        style={{ flex: 1, backgroundColor: c.bg as any }}
        contentInsetAdjustmentBehavior="automatic"
        data={data?.files ?? []}
        keyExtractor={(f) => f.path}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListHeaderComponent={error ? <Note error>{error}</Note> : sync ? <Note>{sync}{data?.worktree ? ' · Luther worktree' : ''}</Note> : undefined}
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
            style={{ flex: 1, color: c.text, backgroundColor: c.card, borderRadius: 12, padding: 11, fontFamily: mono, fontSize: 13 }}
            value={msg}
            onChangeText={setMsg}
            placeholder="Commit message"
            placeholderTextColor={c.dim}
          />
          <Button kind="accent" label="Commit all" disabled={!msg.trim() || busy} onPress={commit} />
        </View>
      )}
    </>
  );
}

