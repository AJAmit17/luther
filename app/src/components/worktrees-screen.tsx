import { Stack, router, useLocalSearchParams } from 'expo-router';
import { alert, EmptyState, Group, ListItem } from '@/design';
import { ListScreen } from '@/features/list-screen';
import { api, del, post } from '@/lib/hosts';
import type { WorktreeInfo } from '@/lib/protocol';
import { useLoad } from '@/lib/use-load';

// Luther's worktrees of a repository: see each one's changes, bring them into
// your checkout, or remove the worktree and its branch.
export default function Worktrees() {
  const { cwd } = useLocalSearchParams<{ cwd: string }>();
  const { data, error, load, pull } = useLoad(() => api<WorktreeInfo[]>('/git/worktrees?cwd=' + encodeURIComponent(cwd)), [cwd]);
  const menu = (w: WorktreeInfo) =>
    alert(w.branch, w.files ? `${w.files} changed file${w.files === 1 ? '' : 's'} (+${w.added} −${w.removed})` : 'No changes', [
      { text: 'Open Its Changes', onPress: () => router.push({ pathname: '/git', params: { cwd: w.path } }) },
      ...(w.files
        ? [{ text: 'Bring Changes Here', onPress: () => post('/git/worktree/bring', { cwd: w.path }).then(() => alert('Done', 'Its changes are in your checkout now, uncommitted.'), (e) => alert('Couldn’t bring them', e.message)) }]
        : []),
      {
        text: 'Remove Worktree and Branch',
        style: 'destructive' as const,
        onPress: () => del(`/git/worktree?cwd=${encodeURIComponent(w.path)}&branch=1&force=1`).then(load, (e) => alert('Remove failed', e.message)),
      },
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  return (
    <>
      <Stack.Screen options={{ title: 'Worktrees' }} />
      <ListScreen
        data={data && (data.length ? [data] : [])}
        error={error}
        pull={pull}
        keyExtractor={() => 'worktrees'}
        empty={<EmptyState icon="square.on.square" title="No Luther worktrees" message="Start a thread in a separate worktree, or compare agents, and its worktree shows up here." />}
        renderItem={({ item }) => (
          <Group footer="Worktrees Luther made for agents (separate-worktree threads, comparisons, schedules). Removing one deletes its checkout and branch; bring its changes over first if you want them.">
            {item.map((w) => (
              <ListItem mono
                key={w.path}
                icon="arrow.triangle.branch"
                title={w.branch || w.path.split('/').pop()!}
                subtitle={w.files ? `${w.files} file${w.files === 1 ? '' : 's'} · +${w.added} −${w.removed}` : 'No changes'}
                onPress={() => menu(w)}
              />
            ))}
          </Group>
        )}
      />
    </>
  );
}
