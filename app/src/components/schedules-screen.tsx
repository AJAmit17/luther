import { Alert, FlatList, RefreshControl, Switch, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { api, del, post } from '@/lib/hosts';
import type { Job } from '@/lib/protocol';
import { describe } from '@/lib/cron';
import { Note, ProviderIcon, Row, ago, c, until, useLoad, listStyle } from '@/components/ui';

// Agent runs on a timetable: each opens a new thread with its prompt. The Mac
// runs them (while it's awake); the phone hears about them like any run.
export default function Schedules() {
  const { cwd } = useLocalSearchParams<{ cwd?: string }>();
  const { data, error, loading, load } = useLoad(() => api<Job[]>('/schedules'), [], 'schedules');
  const jobs = (data ?? []).filter((j) => !cwd || j.cwd === cwd);

  const save = (j: Job) => post('/schedules', j).then(load, (e) => Alert.alert('Could not save', e.message));
  const menu = (j: Job) =>
    Alert.alert(j.name, j.prompt, [
      {
        text: 'Run now',
        onPress: () =>
          post<{ thread: string }>(`/schedules/${j.id}/run`, {}).then(
            (r) => { load(); router.push({ pathname: '/thread/[id]', params: { id: r.thread } }); },
            (e) => Alert.alert('Could not run', e.message),
          ),
      },
      { text: 'Edit', onPress: () => router.push({ pathname: '/schedule', params: { id: j.id } }) },
      { text: 'Delete', style: 'destructive', onPress: () => del(`/schedules/${j.id}`).then(load, (e) => Alert.alert('Error', e.message)) },
      { text: 'Cancel', style: 'cancel' },
    ]);

  return (
    <>
      <Stack.Screen options={{ title: 'Schedules' }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="plus" onPress={() => router.push({ pathname: '/schedule', params: cwd ? { cwd } : {} })} />
      </Stack.Toolbar>
      <FlatList
        contentContainerStyle={listStyle}
        style={{ flex: 1, backgroundColor: c.bg as any }}
        contentInsetAdjustmentBehavior="automatic"
        data={jobs}
        keyExtractor={(j) => j.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListHeaderComponent={error ? <Note error>{error}</Note> : undefined}
        ListEmptyComponent={data ? <Note>No schedules yet. Add one to have an agent run on its own: a nightly test run, a morning summary of open PRs…</Note> : undefined}
        renderItem={({ item: j }) => {
          const last = j.lastRun ? (j.lastError ? ` · last run failed ${ago(j.lastRun)} ago` : ` · ran ${ago(j.lastRun)} ago`) : '';
          return (
            <Row
              icon={<ProviderIcon p={j.provider} />}
              title={j.name}
              sub={`${describe(j.cron)}${j.enabled && j.next ? ` · next ${until(j.next)}` : j.enabled ? '' : ' · paused'}${last}\n${j.cwd.split('/').pop()} · ${j.prompt}`}
              right={
                <View onStartShouldSetResponder={() => true}>
                  <Switch value={j.enabled} onValueChange={(on) => save({ ...j, enabled: on })} />
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
