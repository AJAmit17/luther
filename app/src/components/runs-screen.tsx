import { useEffect } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { api, post } from '@/lib/hosts';
import type { Job, JobRun } from '@/lib/protocol';
import { openThread } from '@/lib/threads';
import { Icon, Note, PulsingDot, c, card, ago, tint, type, useLoad, listStyle, useHex } from '@/components/ui';

// A schedule's runs, newest first: how each went and the agent's report. Open
// one to continue its conversation. Seeing them marks them read.
export default function Runs() {
  useHex();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error, load, pull } = useLoad(() => api<Job[]>('/schedules'), [], 'schedules');
  const job = data?.find((j) => j.id === id);
  const unread = job?.runs?.some((r) => !r.read && r.status !== 'working');
  useEffect(() => {
    if (unread) post(`/schedules/${encodeURIComponent(id)}/read`, {}).then(load, () => {});
  }, [unread, id, load]);

  const open = (r: JobRun) => {
    if (r.session && r.cwd) void openThread({ provider: r.provider, cwd: r.cwd, resume: r.session });
  };

  return (
    <>
      <Stack.Screen options={{ title: job?.name ?? 'Reports' }} />
      <FlatList
        contentContainerStyle={listStyle}
        style={{ flex: 1, backgroundColor: c.bg as any }}
        contentInsetAdjustmentBehavior="automatic"
        data={job?.runs ?? []}
        keyExtractor={(r) => r.id}
        refreshControl={<RefreshControl {...pull} />}
        ListHeaderComponent={error ? <Note error>{error}</Note> : <Note>Scheduled runs are unattended: anything that needed your approval or an answer was declined, and the agent was told to list it in its report.</Note>}
        ListEmptyComponent={data ? <Note>No runs yet.</Note> : undefined}
        renderItem={({ item: r }) => <RunRow r={r} onPress={() => open(r)} />}
      />
    </>
  );
}

function RunRow({ r, onPress }: { r: JobRun; onPress: () => void }) {
  useHex();
  const failed = r.status === 'failed';
  return (
    <Pressable onPress={onPress} disabled={!r.session} style={({ pressed }) => [card, { padding: 13, gap: 8, opacity: pressed ? 0.75 : 1 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {r.status === 'working' ? <PulsingDot size={7} /> : <Icon name={failed ? 'exclamationmark.triangle.fill' : 'checkmark.circle.fill'} size={15} color={failed ? c.red : c.green} />}
        <Text style={[type.subhead, { fontWeight: '600', flex: 1 }]}>
          {r.status === 'working' ? 'Running' : failed ? 'Failed' : 'Finished'} · {ago(r.at)} ago{r.manual ? ' · run by hand' : ''}
        </Text>
        {!r.read && r.status !== 'working' && (
          <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: tint('accent', 0.15) }}>
            <Text style={[type.caption2, { fontWeight: '600', color: c.accent }]}>NEW</Text>
          </View>
        )}
      </View>
      {!!r.report && <Text selectable style={type.footnote} numberOfLines={8}>{r.report}</Text>}
    </Pressable>
  );
}
