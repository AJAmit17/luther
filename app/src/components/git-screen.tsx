import { useState } from 'react';
import { Linking, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { api, del, post } from '@/lib/hosts';
import type { GitStatus, Repository } from '@/lib/protocol';
import { Chip, EmptyState, HeaderActions, Icon, ListItem, Note, Press, Spinner, Surface, Text, TextInput, Tile, alert, prompt, radius, size, space, type as scale, useTheme } from '@/design';
import { ListScreen } from '@/features/list-screen';
import { useLoad } from '@/lib/use-load';
import { openThread } from '@/lib/threads';

const label: Record<string, string> = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', '?': 'new', U: 'conflict' };

// Uncommitted changes in the project: tap a file for its diff, commit everything.
export default function Git() {
  const { color } = useTheme();
  const { cwd } = useLocalSearchParams<{ cwd: string }>();
  const { data, error, pull } = useLoad(() => api<Repository[]>('/git/repos?cwd=' + encodeURIComponent(cwd)), [cwd]);
  const [selected, setSelected] = useState<string | null>(null);
  const repo = data?.find((r) => r.cwd === selected) ?? (data?.length === 1 ? data[0] : null);
  if (repo) return <RepositoryChanges key={repo.cwd} cwd={repo.cwd} name={repo.name} back={data && data.length > 1 ? () => setSelected(null) : undefined} />;
  return (
    <>
      <Stack.Screen options={{ title: 'Repositories' }} />
      <ListScreen
        data={data}
        error={error}
        pull={pull}
        keyExtractor={(r) => r.cwd}
        header={error ? undefined : <Note>Choose a repository. Git actions only affect the selected checkout.</Note>}
        empty={<EmptyState icon="folder" title="No repositories found" message="Choose a folder containing git checkouts (up to four levels deep)." />}
        renderItem={({ item: r }) => (
          <ListItem
            leading={<Tile icon="arrow.triangle.branch" color={color.blue} />}
            title={r.name}
            subtitle={r.error || `${r.branch || 'Detached HEAD'} · ${r.changes ? `${r.changes} changed files` : 'Clean'}`}
            onPress={() => setSelected(r.cwd)}
          />
        )}
      />
    </>
  );
}

function RepositoryChanges({ cwd, name, back }: { cwd: string; name: string; back?: () => void }) {
  const { color } = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { data, error, load, pull } = useLoad(() => api<GitStatus>('/git/status?cwd=' + encodeURIComponent(cwd)), [cwd]);
  const [msg, setMsg] = useState('');
  const subject = msg.split('\n')[0].trim(); // git's summary line, best kept to 72
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false);
  const conflicts = (data?.files ?? []).filter((f) => f.status.includes('U') || f.status === 'AA' || f.status === 'DD');

  // A commit message written from the diff by a quick model call.
  const write = () => {
    setWriting(true);
    post<{ subject: string; body: string }>('/git/message', { cwd })
      .then((m) => setMsg(m.body ? `${m.subject}\n\n${m.body}` : m.subject), (e) => alert('Couldn’t write a message', e.message))
      .finally(() => setWriting(false));
  };
  const resolve = () =>
    openThread(
      { provider: 'claude', cwd, mode: 'edits' },
      false,
      `A ${data?.operation ?? 'merge'} stopped with conflicts in: ${conflicts.map((f) => f.path).join(', ')}. Resolve each one, keeping what both sides meant to do, remove the conflict markers, and run the tests if there are any. Stage the resolved files with git add, but don't commit or continue the ${data?.operation ?? 'merge'}: I'll review first.`,
    );
  const abort = () =>
    alert(`Abort the ${data?.operation}?`, 'Everything goes back to how it was before it started.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Abort', style: 'destructive', onPress: () => run('Abort', post('/git/abort', { cwd })) },
    ]);
  const bring = () =>
    alert('Bring these changes to the main checkout?', 'They’re applied there as uncommitted changes. Nothing is applied if they clash with what’s there.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Bring', onPress: () => run('Bring', post('/git/worktree/bring', { cwd }), () => alert('Done', 'The changes are in the main checkout now, uncommitted.')) },
    ]);

  const commit = () => {
    setBusy(true);
    post<{ output: string }>('/git/commit', { cwd, message: msg.trim() })
      .then((r) => { setMsg(''); load(); alert('Committed', r.output.split('\n')[0]); }, (e) => alert('Commit failed', e.message))
      .finally(() => setBusy(false));
  };

  const run = <T,>(what: string, p: Promise<T>, done?: (r: T) => void) => {
    setBusy(true);
    p.then((r) => { load(); done?.(r); }, (e) => alert(`${what} failed`, e.message)).finally(() => setBusy(false));
  };
  const push = () => run('Push', post<{ output: string }>('/git/push', { cwd }), (r) => alert('Pushed', r.output.split('\n').pop()));
  const pr = () =>
    prompt('Open a Pull Request', `Pushes ${data?.branch ?? 'this branch'} and opens a PR with the Mac's gh login.`, (title) =>
      title.trim() && run('Pull request', post<{ url: string }>('/git/pr', { cwd, title }), (r) => Linking.openURL(r.url)),
    );
  const removeWorktree = (force = false) =>
    alert(force ? 'Remove it anyway?' : 'Remove this worktree?', force ? 'Uncommitted changes in it are lost.' : `The checkout and its branch ${data?.branch ?? ''} are deleted. Bring its changes to the main checkout first if you want them.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          del(`/git/worktree?cwd=${encodeURIComponent(cwd)}&branch=1${force ? '&force=1' : ''}`).then(
            () => router.dismissAll(),
            (e) => (force ? alert('Remove failed', e.message) : removeWorktree(true)),
          ),
      },
    ]);
  const sync = data && (data.upstream ? (data.ahead ? `${data.ahead} commit${data.ahead === 1 ? '' : 's'} ahead of ${data.upstream}` : `Up to date with ${data.upstream}`) : data.branch ? 'Not pushed yet' : '');

  return (
    <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={headerHeight} style={{ flex: 1, backgroundColor: color.bg }}>
      <Stack.Screen options={{ title: data?.branch ? `${name} · ${data.branch}` : name }} />
      <HeaderActions
        actions={[
          ...(back ? [{ icon: 'square.grid.2x2', label: 'All Repositories', onPress: back } as const] : []),
          {
            icon: 'ellipsis.circle',
            label: 'More',
            menu: [
              { title: 'All Diffs', icon: 'doc.text.magnifyingglass', onPress: () => router.push({ pathname: '/diff', params: { cwd } }) },
              { title: 'Push', icon: 'arrow.up.circle', disabled: busy, onPress: push },
              { title: 'Create Pull Request', icon: 'arrow.triangle.pull', disabled: busy, onPress: pr },
              { title: 'Branches and Stashes', icon: 'arrow.triangle.branch', onPress: () => router.push({ pathname: '/branches', params: { cwd } }) },
              data?.worktree
                ? { title: 'Bring to Main Checkout', icon: 'tray.and.arrow.down', disabled: busy || !data.files.length, onPress: bring }
                : { title: 'Worktrees', icon: 'square.on.square', onPress: () => router.push({ pathname: '/worktrees', params: { cwd } }) },
              ...(data?.worktree ? [{ title: 'Remove Worktree', icon: 'trash', destructive: true, onPress: () => removeWorktree() } as const] : []),
            ],
          },
        ]}
      />
      <ListScreen
        data={data?.files}
        error={error}
        pull={pull}
        keyExtractor={(f) => f.path}
        header={
          data ? (
            <View style={{ gap: space.sm }}>
              {!!data.operation && (
                <Surface style={{ padding: space.md, gap: space.md - 2, borderColor: color.warn }}>
                  <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
                    <Icon name="exclamationmark.triangle.fill" size={15} color={color.warn} />
                    <Text variant="subhead" weight="medium" style={{ flex: 1 }}>
                      {`The ${data.operation} stopped${conflicts.length ? ` with ${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'}` : ''}`}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: space.sm }}>
                    {!!conflicts.length && <Chip icon="sparkles" label="Resolve with Agent" tone="accent" onPress={resolve} />}
                    <Chip icon="xmark.circle" label={`Abort ${data.operation}`} onPress={abort} />
                  </View>
                </Surface>
              )}
              {!!sync && <Note>{sync}{data.worktree ? ' · Luther worktree' : ''}</Note>}
            </View>
          ) : undefined
        }
        empty={<EmptyState icon="checkmark.circle" title="Nothing to commit" message="The working tree is clean. Start a thread and its changes show up here." />}
        renderItem={({ item: f }) => {
          const k = f.status.trim()[0] ?? '?';
          return (
            <ListItem
              leading={<Icon name={k === 'D' ? 'minus.circle' : k === '?' || k === 'A' ? 'plus.circle' : 'pencil.circle'} color={k === 'D' ? color.red : k === '?' || k === 'A' ? color.green : color.accent} />}
              title={f.path.split('/').pop()!}
              subtitle={`${f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) + ' · ' : ''}${label[k] ?? f.status}`}
              onPress={() => router.push({ pathname: '/diff', params: { cwd, path: f.path } })}
            />
          );
        }}
      />
      {!!data?.files.length && (
        <View style={{ padding: space.md - 2, paddingBottom: Math.max(insets.bottom, space.md - 2), backgroundColor: color.bg }}>
          <Surface style={{ borderRadius: radius.sheet, padding: space.md - 2, gap: space.sm }}>
            <TextInput
              style={[scale.callout, { maxHeight: 6 * scale.callout.lineHeight, minHeight: 42, paddingHorizontal: space.xs + 2, paddingTop: space.xs, textAlignVertical: 'top' }]}
              value={msg}
              onChangeText={setMsg}
              multiline
              placeholder="Summary of the change"
              accessibilityLabel="Commit message"
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Chip icon="sparkles" label={writing ? 'Writing…' : 'Write for Me'} tone="accent" onPress={write} disabled={writing} />
              <Text variant="caption" color={subject.length > 72 ? 'warn' : undefined} style={{ flex: 1, fontVariant: ['tabular-nums'] }} numberOfLines={1}>
                {subject ? `${subject.length}/72` : `${data.files.length} file${data.files.length === 1 ? '' : 's'}`}
              </Text>
              <Press
                onPress={commit}
                disabled={!msg.trim() || busy}
                accessibilityRole="button"
                accessibilityLabel="Commit All"
                style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + 2, height: size.control, paddingHorizontal: space.md + 2, borderRadius: radius.full, backgroundColor: !!msg.trim() && !busy ? color.accent : color.muted }}
              >
                {busy ? <Spinner /> : <Icon name="checkmark" size={14} color={msg.trim() ? color.onAccent : color.faint} />}
                <Text variant="footnote" weight="medium" style={{ color: !!msg.trim() && !busy ? color.onAccent : color.faint }}>Commit All</Text>
              </Press>
            </View>
          </Surface>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
