import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { Chip, Group, ListItem, Note, SkeletonList, StatusDot, Surface, Text, alert, space, useTheme } from '@/design';
import { AgentTile } from '@/features/agents';
import { ago } from '@/lib/format';
import { useLoad } from '@/lib/use-load';
import { api, post } from '@/lib/hosts';
import type { Health } from '@/lib/protocol';

type Agent = Health['agents'][number];

const state = (a: Agent) => {
  if (!a.installed) return 'Not installed on this Mac';
  const live = a.threads ? `${a.threads} thread${a.threads === 1 ? '' : 's'}` : a.running ? 'running' : 'idle';
  return `${a.version || 'installed'} · ${live}`;
};

// What Luther and each agent are doing on the Mac: versions, whether the
// agent's process is up, how many threads it has; restart one that's stuck.
export default function HealthScreen() {
  const { color } = useTheme();
  const { data, error, load, pull } = useLoad(() => api<Health>('/health'), []);
  const restart = (id: string, name: string, threads: number) =>
    alert(`Restart ${name}?`, threads ? `Its ${threads} open thread${threads === 1 ? '' : 's'} stop; reopening one resumes it. Use this when the agent is stuck.` : 'Its process is stopped; the next thread starts a fresh one.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Restart', style: 'destructive', onPress: () => post(`/agents/${id}/restart`, {}).then(load, (e) => alert('Restart failed', e.message)) },
    ]);
  const installed = data?.agents.filter((a) => a.installed).length ?? 0;
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: color.bg }}
      contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: space.xxl + space.sm }}
      refreshControl={<RefreshControl {...pull} />}
    >
      <Stack.Screen options={{ title: 'Health' }} />
      {!!error && <Note tone="danger">{error}</Note>}
      {!data && !error && <SkeletonList rows={4} />}
      {data && (
        <>
          <Surface style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg }}>
            <StatusDot color={color.green} live size={8} />
            <View style={{ flex: 1, gap: space.xxs }}>
              <Text variant="headline">All running</Text>
              <Text variant="footnote" numberOfLines={1}>
                Luther {data.version} · up {ago(data.started)} · {installed} agent{installed === 1 ? '' : 's'}
              </Text>
            </View>
          </Surface>
          <Group title="Agents">
            {data.agents.map((a) => (
              <ListItem
                key={a.id}
                leading={<AgentTile p={a.id} size={30} />}
                title={a.name}
                subtitle={state(a)}
                trailing={a.installed && (a.running || a.threads) ? <Chip label="Restart" tone="accent" onPress={() => restart(a.id, a.name, a.threads)} /> : undefined}
              />
            ))}
          </Group>
        </>
      )}
      <Group>
        <ListItem icon="doc.plaintext" title="Server Log" onPress={() => router.push('/log')} />
      </Group>
    </ScrollView>
  );
}
