import { useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { api, post } from '@/lib/hosts';
import { Note, c, mono, useLoad, useHex } from '@/components/ui';
import { tb } from '@/components/toolbar-icon';

// A diff: one file (or the whole working tree) against HEAD, or what one turn
// of a thread changed (with a way to undo it).
export default function Diff() {
  useHex();
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
      .then(({ id }) => router.push({ pathname: '/thread/[id]', params: { id } }), (e) => Alert.alert('Couldn’t start a walkthrough', e.message))
      .finally(() => setWalking(false));
  };
  const revert = () =>
    Alert.alert(`Undo turn ${n} and everything after it?`, 'Files go back to how they were before this turn. The conversation itself is kept.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Revert', style: 'destructive', onPress: () => post(turn + '/revert', {}).then(() => router.back(), (e) => Alert.alert('Revert failed', e.message)) },
    ]);
  return (
    <>
      <Stack.Screen options={{ title: turn ? `Turn ${n}` : path ? path.split('/').pop() : 'All changes' }} />
      {(!!turn || !path) && (
        <Stack.Toolbar placement="right">
          {!!data && <Stack.Toolbar.Button icon={tb('sparkles')} onPress={walk} disabled={walking} accessibilityLabel="Walk me through it" />}
          {!!turn && <Stack.Toolbar.Button icon={tb('arrow.uturn.backward')} onPress={revert} />}
        </Stack.Toolbar>
      )}
      <ScrollView style={{ flex: 1, backgroundColor: c.bg as any }} contentInsetAdjustmentBehavior="automatic">
        {!!error && <Note error>{error}</Note>}
        {data === '' && <Note>No differences.</Note>}
        {!!data && (
          <ScrollView horizontal contentContainerStyle={{ padding: 12 }}>
            <Text selectable style={{ fontFamily: mono, fontSize: 12, lineHeight: 17 }}>
              {data.split('\n').map((l, i) => (
                <Text key={i} style={{ color: l.startsWith('+') && !l.startsWith('+++') ? c.green : l.startsWith('-') && !l.startsWith('---') ? c.red : l.startsWith('@@') ? c.blue : c.dim }}>{l + '\n'}</Text>
              ))}
            </Text>
          </ScrollView>
        )}
      </ScrollView>
    </>
  );
}
