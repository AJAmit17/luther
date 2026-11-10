import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Note, Span, Surface, Text, alert, space, tint, useTheme } from '@/design';
import { api, post } from '@/lib/hosts';
import { useLoad } from '@/lib/use-load';

const added = (l: string) => l.startsWith('+') && !l.startsWith('+++');
const removed = (l: string) => l.startsWith('-') && !l.startsWith('---');

// A diff: one file (or the whole working tree) against HEAD, or what one turn
// of a thread changed (with a way to undo it).
export default function Diff() {
  const { color } = useTheme();
  const insets = useSafeAreaInsets();
  const { cwd, path, thread, n } = useLocalSearchParams<{ cwd?: string; path?: string; thread?: string; n?: string }>();
  const turn = thread ? `/threads/${encodeURIComponent(thread)}/turns/${n}` : '';
  const { data, error } = useLoad(
    () => api<string>(turn ? turn + '/diff' : `/git/diff?cwd=${encodeURIComponent(cwd ?? '')}${path ? '&path=' + encodeURIComponent(path) : ''}`),
    [cwd, path, turn],
  );
  // A new thread whose agent explains this change as a page (it opens with the thread).
  const [walking, setWalking] = useState(false);
  const walk = () => {
    setWalking(true);
    post<{ id: string }>('/walkthroughs', turn ? { thread, turn: Number(n) } : { cwd })
      .then(({ id }) => router.push({ pathname: '/thread/[id]', params: { id } }), (e) => alert('Couldn’t start a walkthrough', e.message))
      .finally(() => setWalking(false));
  };
  const revert = () =>
    alert(`Undo turn ${n} and everything after it?`, 'Files go back to how they were before this turn. The conversation itself is kept.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Revert', style: 'destructive', onPress: () => post(turn + '/revert', {}).then(() => router.back(), (e) => alert('Revert failed', e.message)) },
    ]);

  const lines = data ? data.split('\n') : [];
  const plus = lines.filter(added).length;
  const minus = lines.filter(removed).length;
  const title = turn ? `Turn ${n}` : path ?? 'All changes';
  const canWalk = !!data && (!!turn || !path);

  return (
    <>
      <Stack.Screen
        options={{
          title: turn ? `Turn ${n}` : path ? path.split('/').pop() : 'All changes',
          headerTitle: () => (
            <View style={{ alignItems: 'center', maxWidth: 260 }}>
              <Text variant="subhead" weight="medium" mono={!!path && !turn} numberOfLines={1} ellipsizeMode="head">{title}</Text>
              {!!data && (
                <Text variant="caption2" mono>
                  <Span mono color="green">+{plus}</Span> <Span mono color="red">−{minus}</Span>
                </Text>
              )}
            </View>
          ),
        }}
      />
      <ScrollView style={{ flex: 1, backgroundColor: color.bg }} contentContainerStyle={{ padding: space.lg, gap: space.sm }} contentInsetAdjustmentBehavior="automatic">
        {!!error && <Note tone="danger">{error}</Note>}
        {data === '' && <Note>No differences.</Note>}
        {!!data && (
          <Surface style={{ overflow: 'hidden' }}>
            <ScrollView horizontal contentContainerStyle={{ padding: space.md }}>
              <Text selectable mono variant="caption">
                {lines.map((l, i) => {
                  const hunk = l.startsWith('@@');
                  const bg = added(l) ? tint(color.green, 0.12) : removed(l) ? tint(color.red, 0.12) : undefined;
                  const fg = added(l) ? color.green : removed(l) ? color.red : hunk ? color.blue : l.startsWith('diff ') || l.startsWith('+++') || l.startsWith('---') ? color.dim : color.text;
                  return <Span key={i} style={{ color: fg, backgroundColor: bg }}>{l + '\n'}</Span>;
                })}
              </Text>
            </ScrollView>
          </Surface>
        )}
      </ScrollView>
      {(canWalk || !!turn) && (
        <View style={{ flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: Math.max(insets.bottom, space.md), backgroundColor: color.bg }}>
          {!!turn && (
            <View style={{ flex: 1 }}>
              <Button variant="secondary" icon="arrow.uturn.backward" label="Undo Turn" onPress={revert} />
            </View>
          )}
          {canWalk && (
            <View style={{ flex: 1 }}>
              <Button variant="primary" icon="sparkles" label="Walk Me Through It" onPress={walk} busy={walking} />
            </View>
          )}
        </View>
      )}
    </>
  );
}
