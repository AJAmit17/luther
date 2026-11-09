import { Alert, FlatList, RefreshControl } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { api, del, post } from '@/lib/hosts';
import type { WorktreeInfo } from '@/lib/protocol';
import { Icon, Note, Row, c, useLoad, listStyle, useHex } from '@/components/ui';

// Luther's worktrees of a repository: see each one's changes, bring them into
// your checkout, or remove the worktree and its branch.
export default function Worktrees() {
  useHex();
  const { cwd } = useLocalSearchParams<{ cwd: string }>();
  const { data, error, load, pull } = useLoad(() => api<WorktreeInfo[]>('/git/worktrees?cwd=' + encodeURIComponent(cwd)), [cwd]);
  const menu = (w: WorktreeInfo) =>
    Alert.alert(w.branch, w.files ? `${w.files} changed file${w.files === 1 ? '' : 's'} (+${w.added} −${w.removed})` : 'No changes', [
      { text: 'Open its changes', onPress: () => router.push({ pathname: '/git', params: { cwd: w.path } }) },
      ...(w.files
        ? [{ text: 'Bring changes here', onPress: () => post('/git/worktree/bring', { cwd: w.path }).then(() => Alert.alert('Done', 'Its changes are in your checkout now, uncommitted.'), (e) => Alert.alert('Couldn’t bring them', e.message)) }]
        : []),
      {
        text: 'Remove worktree and branch',
        style: 'destructive' as const,
        onPress: () => del(`/git/worktree?cwd=${encodeURIComponent(w.path)}&branch=1&force=1`).then(load, (e) => Alert.alert('Remove failed', e.message)),
      },
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  return (
    <>
      <Stack.Screen options={{ title: 'Worktrees' }} />
      <FlatList
        contentContainerStyle={listStyle}
        style={{ flex: 1, backgroundColor: c.bg as any }}
        contentInsetAdjustmentBehavior="automatic"
        data={data ?? []}
        keyExtractor={(w) => w.path}
        refreshControl={<RefreshControl {...pull} />}
        ListHeaderComponent={error ? <Note error>{error}</Note> : <Note>Worktrees Luther made for agents (separate-worktree threads, comparisons, schedules). Removing one deletes its checkout and branch; bring its changes over first if you want them.</Note>}
        ListEmptyComponent={data ? <Note>No Luther worktrees in this repository.</Note> : undefined}
        renderItem={({ item: w }) => (
          <Row
            icon={<Icon name="arrow.triangle.branch" color={w.files ? c.accent : c.dim} />}
            title={w.branch || w.path.split('/').pop()!}
            sub={w.files ? `${w.files} file${w.files === 1 ? '' : 's'} · +${w.added} −${w.removed}` : 'No changes'}
            onPress={() => menu(w)}
          />
        )}
      />
    </>
  );
}
