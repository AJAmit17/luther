import { View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Chip, EmptyState, Group, ListItem, Text, alert, radius, useTheme } from '@/design';
import { ListScreen } from '@/features/list-screen';
import { api, post } from '@/lib/hosts';
import type { Turn } from '@/lib/protocol';
import { ago } from '@/lib/format';
import { useLoad } from '@/lib/use-load';

// Every turn of an open thread, newest first, with the files it changed. Tap
// one for its diff; Undo rolls the project back to before it.
export default function Turns() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error, load, pull } = useLoad(() => api<Turn[]>(`/threads/${encodeURIComponent(id)}/turns`), [id]);
  const undo = (n: number) =>
    alert(`Undo turn ${n} and everything after it?`, 'Files go back to how they were before this turn. The conversation itself is kept.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Revert', style: 'destructive', onPress: () => post(`/threads/${encodeURIComponent(id)}/turns/${n}/revert`, {}).then(load, (e) => alert('Revert failed', e.message)) },
    ]);
  return (
    <>
      <Stack.Screen options={{ title: 'Turns and Undo' }} />
      <ListScreen
        data={data && (data.length ? [data] : [])}
        error={error}
        pull={pull}
        keyExtractor={() => 'turns'}
        empty={<EmptyState icon="clock.arrow.circlepath" title="No turns yet" message="Each message you send starts one; its changes show up here." />}
        renderItem={({ item }) => (
          <Group footer="Undo puts the files back as they were before that turn. The conversation stays.">
            {item.map((t) => (
              <ListItem
                key={t.n}
                leading={<Badge n={t.n} live={!t.endedAt} />}
                title={t.prompt || '(attachments)'}
                subtitle={`${t.files === 1 ? '1 file' : `${t.files} files`} · ${ago(t.startedAt)}${t.endedAt ? '' : ' · running'}`}
                trailing={t.files && t.endedAt ? <Chip label="Undo" onPress={() => undo(t.n)} accessibilityLabel={`Undo turn ${t.n}`} /> : false}
                onPress={() => router.push({ pathname: '/diff', params: { thread: id, n: String(t.n) } })}
              />
            ))}
          </Group>
        )}
      />
    </>
  );
}

function Badge({ n, live }: { n: number; live: boolean }) {
  const { color } = useTheme();
  return (
    <View style={{ minWidth: 22, height: 22, paddingHorizontal: 5, borderRadius: radius.full, backgroundColor: live ? color.accent : color.muted, alignItems: 'center', justifyContent: 'center' }}>
      <Text variant="caption2" mono weight="medium" style={{ color: live ? color.onAccent : color.dim }}>{n}</Text>
    </View>
  );
}
