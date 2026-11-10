import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { EmptyState, HeaderActions, Note, Pill, Press, StatusDot, Surface, Text, space, useTheme, type Tone } from '@/design';
import { ListScreen } from '@/features/list-screen';
import { api, post } from '@/lib/hosts';
import { useLoad } from '@/lib/use-load';
import type { Job, JobRun } from '@/lib/protocol';
import { openThread } from '@/lib/threads';

const STATUS: Record<JobRun['status'], { label: string; tone: Tone }> = {
  working: { label: 'Running', tone: 'accent' },
  finished: { label: 'Done', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
};

/** "Tue 02:00" within the week, "Nov 3, 02:00" before it. */
function when(t: number) {
  const d = new Date(t);
  const clock = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const day = Date.now() - t < 6 * 86400e3 ? d.toLocaleDateString(undefined, { weekday: 'short' }) : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })},`;
  return `${day} ${clock}`;
}

/** "6m 12s", "1h 4m". */
function took(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

// A schedule's runs, newest first: how each went and the agent's report. Open
// one to continue its conversation. Seeing them marks them read.
export default function Runs() {
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
      {!!job && (
        <HeaderActions actions={[{ icon: 'pencil', label: 'Edit Schedule', onPress: () => router.push({ pathname: '/schedule', params: { id: job.id } }) }]} />
      )}
      <ListScreen
        data={data ? (job?.runs ?? []) : null}
        error={error}
        pull={pull}
        keyExtractor={(r) => r.id}
        empty={<EmptyState icon="clock.arrow.circlepath" title="No runs yet" message="Each run’s report shows up here." />}
        footer={<Note>Scheduled runs are unattended: anything that needed your approval or an answer was declined, and the agent was told to list it in its report.</Note>}
        renderItem={({ item: r }) => <RunCard r={r} onPress={() => open(r)} />}
      />
    </>
  );
}

function RunCard({ r, onPress }: { r: JobRun; onPress: () => void }) {
  const { color } = useTheme();
  const s = STATUS[r.status] ?? STATUS.finished;
  const fresh = !r.read && r.status !== 'working';
  return (
    <Press onPress={r.session ? onPress : undefined} accessibilityRole={r.session ? 'button' : undefined}>
      <Surface style={{ padding: space.md + 2, gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Pill label={s.label} tone={s.tone} live={r.status === 'working'} />
          <Text variant="caption" style={{ flex: 1 }} numberOfLines={1}>
            {when(r.at)}
            {r.ended ? ` · ${took(r.ended - r.at)}` : ''}
            {r.manual ? ' · run by hand' : ''}
          </Text>
          {fresh && <StatusDot color={color.accent} size={7} />}
        </View>
        {!!r.report && <Text selectable variant="callout" numberOfLines={8}>{r.report}</Text>}
      </Surface>
    </Press>
  );
}
