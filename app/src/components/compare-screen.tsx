import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Chip, Note, Pill, Surface, Text, alert, space, useTheme, type Tone } from '@/design';
import { AgentTile, agentName } from '@/features/agents';
import { api, post } from '@/lib/hosts';
import { useLoad } from '@/lib/use-load';
import type { Compare, CompareRun } from '@/lib/protocol';
import { openThread } from '@/lib/threads';

const STATUS: Record<NonNullable<CompareRun['status']>, { label: string; tone: Tone }> = {
  working: { label: 'Working', tone: 'accent' },
  waiting: { label: 'Needs You', tone: 'warning' },
  finished: { label: 'Done', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  idle: { label: 'Not Started', tone: 'neutral' },
  ended: { label: 'Closed', tone: 'neutral' },
};

// One comparison: each agent's run side by side (status, size of its change,
// its last reply). Open a run, read its diff, keep it, or combine the best.
export default function CompareScreen() {
  const { color } = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error, load } = useLoad(() => api<Compare>(`/compares/${encodeURIComponent(id)}`), [id]);
  const working = data?.runs.some((r) => r.status === 'working' || r.status === 'waiting');
  useEffect(() => {
    if (!working) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [working, load]);
  const [busy, setBusy] = useState('');

  const keep = useCallback(
    (r: CompareRun) =>
      alert(`Keep ${agentName(r.provider)}’s changes?`, 'They’re applied to your checkout as uncommitted changes, for you to review and commit. Nothing is applied if they clash with what’s there.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Keep',
          onPress: () => {
            setBusy(r.thread!);
            post(`/compares/${encodeURIComponent(id)}/keep`, { thread: r.thread })
              .then(
                () => {
                  load();
                  router.push({ pathname: '/git', params: { cwd: data!.cwd } });
                },
                (e) => alert('Couldn’t keep it', e.message),
              )
              .finally(() => setBusy(''));
          },
        },
      ]),
    [id, load, data],
  );
  const combine = () => {
    setBusy('combine');
    post<{ id: string }>(`/compares/${encodeURIComponent(id)}/combine`, {})
      .then((r) => router.push({ pathname: '/thread/[id]', params: { id: r.id, cwd: data!.cwd } }), (e) => alert('Couldn’t start', e.message))
      .finally(() => setBusy(''));
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <Stack.Screen options={{ title: 'Comparison' }} />
      <ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: space.lg, gap: space.sm + 2, paddingBottom: space.xl }}>
        {!!error && <Note tone="danger">{error}</Note>}
        {data && (
          <>
            <Surface style={{ padding: space.md + 2, gap: space.xs }}>
              <Text variant="caption" weight="medium" style={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>Prompt</Text>
              <Text selectable variant="callout">{data.prompt}</Text>
            </Surface>
            {data.runs.map((r, i) => (
              <RunCard key={r.thread ?? i} r={r} kept={!!r.thread && data.kept === r.thread} busy={busy === r.thread} onKeep={() => keep(r)} />
            ))}
          </>
        )}
      </ScrollView>
      {data && (
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.md + insets.bottom, gap: space.sm }}>
          <Text variant="footnote" style={{ textAlign: 'center' }}>{working ? 'Keep and combine wait until every agent is done.' : 'A new thread in your checkout reads every run’s changes and merges the best of them.'}</Text>
          <Button
            variant="primary"
            icon="sparkles"
            label={busy === 'combine' ? 'Starting…' : 'Combine with Claude'}
            busy={busy === 'combine'}
            disabled={!!working || data.runs.filter((r) => r.worktree).length < 2}
            onPress={combine}
          />
        </View>
      )}
    </View>
  );
}

function RunCard({ r, kept, busy, onKeep }: { r: CompareRun; kept: boolean; busy: boolean; onKeep: () => void }) {
  const { color } = useTheme();
  const live = r.status === 'working' || r.status === 'waiting';
  const s = r.error ? { label: 'Didn’t Start', tone: 'danger' as const } : STATUS[r.status ?? 'ended'];
  const open = () => r.thread && r.worktree && void openThread({ provider: r.provider, cwd: r.worktree, resume: r.session ?? r.thread });
  return (
    <Surface style={[{ padding: space.md + 2, gap: space.sm + 2 }, kept && { borderColor: color.green }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm + 2 }}>
        <AgentTile p={r.provider} size={28} />
        <Text variant="headline" numberOfLines={1} style={{ flex: 1 }}>
          {agentName(r.provider)}
          {r.model ? ` · ${r.model}` : ''}
        </Text>
        {kept ? <Pill label="Kept" tone="success" icon="checkmark" /> : <Pill label={s.label} tone={s.tone} live={live} />}
      </View>
      {!!(r.error || r.reply) && <Text selectable variant="subhead" color={r.error ? 'red' : undefined} numberOfLines={5}>{r.error || r.reply}</Text>}
      {!r.error && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + 2 }}>
          <Text mono variant="caption" numberOfLines={1} style={{ flex: 1 }}>
            {r.files ? `+${r.added} −${r.removed} · ${r.files} file${r.files === 1 ? '' : 's'}` : 'no changes yet'}
          </Text>
          {!!r.files && <Chip label="Diff" onPress={() => router.push({ pathname: '/diff', params: { cwd: r.worktree! } })} />}
          <Chip label="Open" onPress={open} />
          {!!r.files && !live && !kept && <Chip label={busy ? 'Keeping…' : 'Keep'} tone="accent" onPress={onKeep} />}
        </View>
      )}
    </Surface>
  );
}
