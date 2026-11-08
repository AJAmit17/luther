import { Alert, SectionList, RefreshControl, Text } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { api, del, post } from '@/lib/hosts';
import type { Branches } from '@/lib/protocol';
import { Icon, Note, Row, ago, c, type, useLoad, listStyle, useHex } from '@/components/ui';
import { tb } from '@/components/toolbar-icon';

// Branches (switch, or start a new one) and stashes (put your changes aside,
// bring them back) of one repository.
export default function BranchesScreen() {
  useHex();
  const { cwd } = useLocalSearchParams<{ cwd: string }>();
  const q = encodeURIComponent(cwd);
  const { data, error, load, pull } = useLoad(() => api<Branches>('/git/branches?cwd=' + q), [cwd]);
  const act = (what: string, p: Promise<unknown>) => p.then(load, (e) => Alert.alert(`${what} failed`, e.message));

  const switchTo = (name: string) =>
    Alert.alert(`Switch to ${name}?`, 'Your uncommitted changes come along; git refuses if they would be overwritten, and nothing is lost.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Switch', onPress: () => act('Switch', post('/git/checkout', { cwd, branch: name })) },
    ]);
  const create = () =>
    Alert.prompt('New branch', `Starts from ${data?.current || 'here'} and switches to it; your changes come along.`, (name) => name.trim() && act('New branch', post('/git/checkout', { cwd, branch: name.trim(), create: true })));
  const stash = () =>
    Alert.prompt('Stash your changes', 'Every uncommitted change, new files included, is put aside and the checkout is clean again. Name it (optional):', (m) => act('Stash', post('/git/stash', { cwd, message: m })));
  const stashMenu = (ref: string, message: string) =>
    Alert.alert(message, ref, [
      { text: 'Bring back (and drop)', onPress: () => act('Bring back', post('/git/stash/apply', { cwd, ref, drop: true })) },
      { text: 'Bring back (keep it too)', onPress: () => act('Apply', post('/git/stash/apply', { cwd, ref })) },
      { text: 'Drop', style: 'destructive', onPress: () => act('Drop', del(`/git/stash?cwd=${q}&ref=${encodeURIComponent(ref)}`)) },
      { text: 'Cancel', style: 'cancel' },
    ]);

  type Item = { key: string; kind: 'branch' | 'stash'; name: string; last: number; upstream?: string; ref?: string };
  const sections: { title: string; data: Item[] }[] = data
    ? [
        { title: 'Branches', data: data.branches.map((b) => ({ key: 'b:' + b.name, kind: 'branch' as const, ...b })) },
        { title: 'Stashes', data: data.stashes.map((s) => ({ key: 's:' + s.ref, kind: 'stash' as const, name: s.message, ref: s.ref, last: s.at })) },
      ]
    : [];
  return (
    <>
      <Stack.Screen options={{ title: 'Branches and stashes' }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon={tb('plus')}>
          <Stack.Toolbar.MenuAction icon={tb('arrow.triangle.branch')} onPress={create}>New branch</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon={tb('archivebox')} onPress={stash}>Stash changes</Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <SectionList
        contentContainerStyle={listStyle}
        style={{ flex: 1, backgroundColor: c.bg as any }}
        contentInsetAdjustmentBehavior="automatic"
        sections={sections}
        keyExtractor={(x) => x.key}
        refreshControl={<RefreshControl {...pull} />}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={error ? <Note error>{error}</Note> : undefined}
        renderSectionHeader={({ section }) => <Text style={[type.footnote, { fontWeight: '600', textTransform: 'uppercase', paddingHorizontal: 4, paddingTop: 10 }]}>{section.title}</Text>}
        renderSectionFooter={({ section }) => (!section.data.length ? <Note>{section.title === 'Stashes' ? 'No stashes. Use + to put your changes aside.' : 'No branches yet.'}</Note> : null)}
        renderItem={({ item: x }) =>
          x.kind === 'branch' ? (
            <Row
              icon={<Icon name={x.name === data?.current ? 'checkmark.circle.fill' : 'arrow.triangle.branch'} color={x.name === data?.current ? c.accent : c.dim} />}
              title={x.name}
              sub={`${x.name === data?.current ? 'Current · ' : ''}${x.upstream ? `tracks ${x.upstream} · ` : ''}last commit ${ago(x.last)} ago`}
              onPress={x.name === data?.current ? undefined : () => switchTo(x.name)}
            />
          ) : (
            <Row icon={<Icon name="archivebox" color={c.dim} />} title={x.name} sub={`${x.ref} · ${ago(x.last)} ago`} onPress={() => stashMenu(x.ref!, x.name)} />
          )
        }
      />
    </>
  );
}
