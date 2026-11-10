import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Button, EmptyState, HeaderActions, LargeTitle, ListItem, Toggle, alert, useTheme } from '@/design';
import { AgentTile } from '@/features/agents';
import { ListScreen } from '@/features/list-screen';
import { api, del, post } from '@/lib/hosts';
import { until, since } from '@/lib/format';
import { useLoad } from '@/lib/use-load';
import type { Job } from '@/lib/protocol';
import { describe } from '@/lib/cron';

/** Reports of finished runs not seen yet. */
export const news = (j: Job) => j.runs?.filter((r) => !r.read && r.status !== 'working').length ?? 0;

/** A page of a calendar with one day marked: the empty state's picture. */
function CalendarArt() {
  const { color } = useTheme();
  const cells = [0, 1, 2, 3].flatMap((x) => [0, 1].map((y) => ({ x, y })));
  return (
    <Svg width={104} height={96} viewBox="0 0 104 96" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Rect x={2} y={12} width={100} height={82} rx={14} fill={color.card} stroke={color.line} strokeWidth={1.5} />
      <Path d="M2 26 Q2 12 16 12 L88 12 Q102 12 102 26 L102 32 L2 32 Z" fill={color.muted} />
      <Rect x={30} y={2} width={5} height={20} rx={2.5} fill={color.faint} />
      <Rect x={69} y={2} width={5} height={20} rx={2.5} fill={color.faint} />
      {cells.map(({ x, y }) => (
        <Rect key={`${x}${y}`} x={16 + x * 20} y={44 + y * 20} width={12} height={12} rx={3} fill={x === 2 && y === 0 ? color.accent : color.muted} />
      ))}
    </Svg>
  );
}

// Agent runs on a timetable: each opens a new thread with its prompt. The Mac
// runs them (while it's awake); the phone hears about them like any run.
export default function Schedules() {
  const { cwd } = useLocalSearchParams<{ cwd?: string }>();
  const { data, error, load, pull } = useLoad(() => api<Job[]>('/schedules'), [], 'schedules');
  const jobs = data ? data.filter((j) => !cwd || j.cwd === cwd) : data;
  const add = () => router.push({ pathname: '/schedule', params: cwd ? { cwd } : {} });

  const save = (j: Job) => post('/schedules', j).then(load, (e) => alert('Could not save', e.message));
  const menu = (j: Job) =>
    alert(j.name, j.prompt, [
      {
        text: 'Run Now',
        onPress: () =>
          post<{ thread: string }>(`/schedules/${j.id}/run`, {}).then(
            (r) => {
              load();
              router.push({ pathname: '/thread/[id]', params: { id: r.thread } });
            },
            (e) => alert('Could not run', e.message),
          ),
      },
      ...(j.runs?.length ? [{ text: `Reports${news(j) ? ` (${news(j)} new)` : ''}`, onPress: () => router.push({ pathname: '/runs', params: { id: j.id } }) }] : []),
      { text: 'Edit', onPress: () => router.push({ pathname: '/schedule', params: { id: j.id } }) },
      { text: 'Delete', style: 'destructive', onPress: () => del(`/schedules/${j.id}`).then(load, (e) => alert('Error', e.message)) },
      { text: 'Cancel', style: 'cancel' },
    ]);

  return (
    <>
      <Stack.Screen options={{ title: 'Schedules' }} />
      <HeaderActions actions={[{ icon: 'plus', label: 'New Schedule', onPress: add }]} />
      <ListScreen
        data={jobs}
        error={error}
        pull={pull}
        keyExtractor={(j) => j.id}
        header={<LargeTitle>Schedules</LargeTitle>}
        empty={
          <EmptyState
            art={<CalendarArt />}
            title="No schedules yet"
            message="Run an agent on a timer: nightly tests, a morning review, a weekly dependency bump."
            action={<Button variant="primary" label="New Schedule" onPress={add} />}
          />
        }
        renderItem={({ item: j }) => {
          const last = j.lastRun ? (j.lastError ? ` · last run failed ${since(j.lastRun)}` : ` · ran ${since(j.lastRun)}`) : '';
          const fresh = news(j);
          return (
            <ListItem
              leading={<AgentTile p={j.provider} />}
              title={j.name}
              subtitle={`${describe(j.cron)}${j.enabled && j.next ? ` · next ${until(j.next)}` : j.enabled ? '' : ' · paused'}${last}${fresh ? ` · ${fresh} new report${fresh === 1 ? '' : 's'}` : ''}\n${j.cwd.split('/').pop()} · ${j.prompt}`}
              subtitleLines={2}
              trailing={
                <View onStartShouldSetResponder={() => true}>
                  <Toggle label={`Run ${j.name || 'this schedule'}`} value={j.enabled} onValueChange={(on) => save({ ...j, enabled: on })} />
                </View>
              }
              onPress={() => menu(j)}
            />
          );
        }}
      />
    </>
  );
}
