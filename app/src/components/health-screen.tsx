import { Alert, FlatList, RefreshControl, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { api, post } from '@/lib/hosts';
import type { Health } from '@/lib/protocol';
import { Note, ProviderIcon, Row, ago, c, type, useLoad, listStyle, useHex } from '@/components/ui';

// What Luther and each agent are doing on the Mac: versions, whether the
// agent's process is up, how many threads it has; restart one that's stuck.
export default function HealthScreen() {
  useHex();
  const { data, error, load, pull } = useLoad(() => api<Health>('/health'), []);
  const restart = (id: string, name: string, threads: number) =>
    Alert.alert(`Restart ${name}?`, threads ? `Its ${threads} open thread${threads === 1 ? '' : 's'} stop; reopening one resumes it. Use this when the agent is stuck.` : 'Its process is stopped; the next thread starts a fresh one.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Restart', style: 'destructive', onPress: () => post(`/agents/${id}/restart`, {}).then(load, (e) => Alert.alert('Restart failed', e.message)) },
    ]);
  return (
    <>
      <Stack.Screen options={{ title: 'Health' }} />
      <FlatList
        contentContainerStyle={listStyle}
        style={{ flex: 1, backgroundColor: c.bg as any }}
        contentInsetAdjustmentBehavior="automatic"
        data={data?.agents ?? []}
        keyExtractor={(a) => a.id}
        refreshControl={<RefreshControl {...pull} />}
        ListHeaderComponent={
          error ? (
            <Note error>{error}</Note>
          ) : data ? (
            <View style={{ gap: 2, paddingHorizontal: 4, paddingBottom: 6 }}>
              <Text style={type.headline}>{data.name}</Text>
              <Text style={type.footnote}>Luther {data.version} · up for {ago(data.started)}</Text>
            </View>
          ) : undefined
        }
        renderItem={({ item: a }) => (
          <Row
            icon={<ProviderIcon p={a.id} />}
            title={a.name}
            sub={a.installed ? `${a.version || 'installed'}\n${a.running ? 'Running' : 'Not running'} · ${a.threads} open thread${a.threads === 1 ? '' : 's'}` : 'Not installed on this Mac'}
            right={a.installed && (a.running || a.threads) ? <Text style={[type.footnote, { color: c.accent, fontWeight: '600' }]}>Restart</Text> : undefined}
            onPress={a.installed && (a.running || a.threads) ? () => restart(a.id, a.name, a.threads) : undefined}
          />
        )}
      />
    </>
  );
}
