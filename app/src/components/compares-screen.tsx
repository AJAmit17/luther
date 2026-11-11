import { View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Button, EmptyState, HeaderActions, ListItem, space } from '@/design';
import { AgentMark } from '@/features/agents';
import { ListScreen } from '@/features/list-screen';
import { api } from '@/lib/hosts';
import { since } from '@/lib/format';
import { useLoad } from '@/lib/use-load';
import type { Compare } from '@/lib/protocol';

// A project's comparisons, newest first.
export default function Compares() {
  const { cwd } = useLocalSearchParams<{ cwd: string }>();
  const { data, error, pull } = useLoad(() => api<Compare[]>('/compares?cwd=' + encodeURIComponent(cwd)), [cwd]);
  const add = () => router.push({ pathname: '/compare-new', params: { cwd } });
  return (
    <>
      <Stack.Screen options={{ title: 'Compare Agents' }} />
      <HeaderActions actions={[{ icon: 'plus', label: 'Compare Agents', onPress: add }]} />
      <ListScreen
        data={data}
        error={error}
        pull={pull}
        keyExtractor={(x) => x.id}
        empty={
          <EmptyState
            icon="arrow.left.and.right"
            title="No comparisons yet"
            message="Give one task to several agents at once, each in its own worktree, and keep the best result."
            action={<Button variant="primary" label="Compare Agents" onPress={add} />}
          />
        }
        renderItem={({ item: x }) => {
          const live = x.runs.filter((r) => r.status === 'working' || r.status === 'waiting').length;
          return (
            <ListItem
              leading={
                <View style={{ flexDirection: 'row', gap: space.xxs }}>
                  {x.runs.slice(0, 3).map((r, i) => <AgentMark key={i} p={r.provider} size={14} />)}
                </View>
              }
              title={x.prompt}
              subtitle={`${x.runs.length} agents · ${since(x.created)}${live ? ` · ${live} working` : ''}${x.kept ? ' · kept one' : ''}`}
              onPress={() => router.push({ pathname: '/compare/[id]', params: { id: x.id } })}
            />
          );
        }}
      />
    </>
  );
}
