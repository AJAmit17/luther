import { ScrollView, Text } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { api } from '@/lib/hosts';
import { Note, c, mono, useLoad } from '@/components/ui';

// Diff of one file (or the whole working tree) against HEAD.
export default function Diff() {
  const { cwd, path } = useLocalSearchParams<{ cwd: string; path?: string }>();
  const { data, error } = useLoad(() => api<string>(`/git/diff?cwd=${encodeURIComponent(cwd)}${path ? '&path=' + encodeURIComponent(path) : ''}`), [cwd, path]);
  return (
    <>
      <Stack.Screen options={{ title: path ? path.split('/').pop() : 'All changes' }} />
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
