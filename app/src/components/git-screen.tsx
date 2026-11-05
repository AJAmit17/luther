import { useState } from 'react';
import { Alert, FlatList, RefreshControl, TextInput, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, post } from '@/lib/hosts';
import type { GitStatus } from '@/lib/protocol';
import { Button, Icon, Note, Row, c, mono, useLoad } from '@/components/ui';

const label: Record<string, string> = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', '?': 'new', U: 'conflict' };

// Uncommitted changes in the project: tap a file for its diff, commit everything.
export default function Git() {
  const { cwd } = useLocalSearchParams<{ cwd: string }>();
  const insets = useSafeAreaInsets();
  const { data, error, loading, load } = useLoad(() => api<GitStatus>('/git/status?cwd=' + encodeURIComponent(cwd)), [cwd]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const commit = () => {
    setBusy(true);
    post<{ output: string }>('/git/commit', { cwd, message: msg.trim() })
      .then((r) => { setMsg(''); load(); Alert.alert('Committed', r.output.split('\n')[0]); }, (e) => Alert.alert('Commit failed', e.message))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <Stack.Screen options={{ title: data?.branch ? `Changes · ${data.branch}` : 'Changes' }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button onPress={() => router.push({ pathname: '/diff', params: { cwd } })}>All diffs</Stack.Toolbar.Button>
      </Stack.Toolbar>
      <FlatList
        style={{ flex: 1, backgroundColor: c.bg as any }}
        contentInsetAdjustmentBehavior="automatic"
        data={data?.files ?? []}
        keyExtractor={(f) => f.path}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListHeaderComponent={error ? <Note error>{error}</Note> : undefined}
        ListEmptyComponent={data ? <Note>Nothing to commit. Working tree clean.</Note> : undefined}
        renderItem={({ item: f }) => {
          const k = (f.status.trim()[0] ?? '?') as string;
          return (
            <Row
              icon={<Icon name={k === 'D' ? 'minus.circle' : k === '?' || k === 'A' ? 'plus.circle' : 'pencil.circle'} color={k === 'D' ? c.red : k === '?' || k === 'A' ? c.green : c.accent} />}
              title={f.path.split('/').pop()!}
              sub={`${f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) + ' · ' : ''}${label[k] ?? f.status}`}
              onPress={() => router.push({ pathname: '/diff', params: { cwd, path: f.path } })}
            />
          );
        }}
      />
      {!!data?.files.length && (
        <View style={{ flexDirection: 'row', gap: 8, padding: 10, paddingBottom: Math.max(insets.bottom, 10), borderTopWidth: 0.5, borderColor: c.line as any }}>
          <TextInput
            style={{ flex: 1, color: c.text, backgroundColor: c.card, borderRadius: 12, padding: 11, fontFamily: mono, fontSize: 13 }}
            value={msg}
            onChangeText={setMsg}
            placeholder="Commit message"
            placeholderTextColor={c.dim}
          />
          <Button kind="accent" label="Commit all" disabled={!msg.trim() || busy} onPress={commit} />
        </View>
      )}
    </>
  );
}

