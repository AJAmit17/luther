import { View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { alert, Group, HeaderActions, ListItem, Note, prompt, space } from '@/design';
import { ListScreen } from '@/features/list-screen';
import { api, del, post } from '@/lib/hosts';
import type { Branches } from '@/lib/protocol';
import { since } from '@/lib/format';
import { useLoad } from '@/lib/use-load';

// Branches (switch, or start a new one) and stashes (put your changes aside,
// bring them back) of one repository.
export default function BranchesScreen() {
  const { cwd } = useLocalSearchParams<{ cwd: string }>();
  const q = encodeURIComponent(cwd);
  const { data, error, load, pull } = useLoad(() => api<Branches>('/git/branches?cwd=' + q), [cwd]);
  const act = (what: string, p: Promise<unknown>) => p.then(load, (e) => alert(`${what} failed`, e.message));

  const switchTo = (name: string) =>
    alert(`Switch to ${name}?`, 'Your uncommitted changes come along; git refuses if they would be overwritten, and nothing is lost.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Switch', onPress: () => act('Switch', post('/git/checkout', { cwd, branch: name })) },
    ]);
  const create = () =>
    prompt('New Branch', `Starts from ${data?.current || 'here'} and switches to it; your changes come along.`, (name) => name.trim() && act('New Branch', post('/git/checkout', { cwd, branch: name.trim(), create: true })));
  const stash = () =>
    prompt('Stash Your Changes', 'Every uncommitted change, new files included, is put aside and the checkout is clean again. Name it (optional):', (m) => act('Stash', post('/git/stash', { cwd, message: m })));
  const stashMenu = (ref: string, message: string) =>
    alert(message, ref, [
      { text: 'Bring Back (and Drop)', onPress: () => act('Bring back', post('/git/stash/apply', { cwd, ref, drop: true })) },
      { text: 'Bring Back (Keep It Too)', onPress: () => act('Apply', post('/git/stash/apply', { cwd, ref })) },
      { text: 'Drop', style: 'destructive', onPress: () => act('Drop', del(`/git/stash?cwd=${q}&ref=${encodeURIComponent(ref)}`)) },
      { text: 'Cancel', style: 'cancel' },
    ]);

  return (
    <>
      <Stack.Screen options={{ title: 'Branches and Stashes' }} />
      <HeaderActions
        actions={[
          {
            icon: 'plus',
            label: 'Add',
            menu: [
              { title: 'New Branch', icon: 'arrow.triangle.branch', onPress: create },
              { title: 'Stash Changes', icon: 'archivebox', onPress: stash },
            ],
          },
        ]}
      />
      <ListScreen
        data={data && [data]}
        error={error}
        pull={pull}
        keyExtractor={() => 'branches'}
        renderItem={({ item: b }) => (
          <View style={{ gap: space.lg }}>
            {b.branches.length ? (
              <Group title="Branches">
                {b.branches.map((x) => {
                  const current = x.name === b.current;
                  return (
                    <ListItem mono
                      key={x.name}
                      icon="arrow.triangle.branch"
                      title={x.name}
                      subtitle={[current ? 'Current' : '', x.upstream ? `tracks ${x.upstream}` : '', `last commit ${since(x.last)}`].filter(Boolean).join(' · ')}
                      selected={current}
                      onPress={current ? undefined : () => switchTo(x.name)}
                    />
                  );
                })}
              </Group>
            ) : (
              <Note>No branches yet.</Note>
            )}
            {b.stashes.length ? (
              <Group title="Stashes">
                {b.stashes.map((s) => (
                  <ListItem mono key={s.ref} icon="archivebox" title={s.message} subtitle={`${s.ref} · ${since(s.at)}`} onPress={() => stashMenu(s.ref, s.message)} />
                ))}
              </Group>
            ) : (
              <Note>No stashes. Use + to put your changes aside.</Note>
            )}
          </View>
        )}
      />
    </>
  );
}
