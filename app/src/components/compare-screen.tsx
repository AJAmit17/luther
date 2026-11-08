import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { api, post } from '@/lib/hosts';
import type { Compare, CompareRun } from '@/lib/protocol';
import { openThread } from '@/lib/threads';
import { Button, Icon, Note, ProviderIcon, PulsingDot, c, card, providerName, tint, type, useLoad, useHex } from '@/components/ui';

const label: Record<string, string> = { working: 'Working', waiting: 'Needs you', finished: 'Done', failed: 'Failed', idle: 'Not started', ended: 'Closed' };

// One comparison: each agent's run side by side (status, size of its change,
// its last reply). Open a run, read its diff, keep it, or combine the best.
export default function CompareScreen() {
  useHex();
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
      Alert.alert(`Keep ${providerName(r.provider)}’s changes?`, 'They’re applied to your checkout as uncommitted changes, for you to review and commit. Nothing is applied if they clash with what’s there.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Keep',
          onPress: () => {
            setBusy(r.thread!);
            post(`/compares/${encodeURIComponent(id)}/keep`, { thread: r.thread })
              .then(() => { load(); router.push({ pathname: '/git', params: { cwd: data!.cwd } }); }, (e) => Alert.alert('Couldn’t keep it', e.message))
              .finally(() => setBusy(''));
          },
        },
      ]),
    [id, load, data],
  );
  const combine = () => {
    setBusy('combine');
    post<{ id: string }>(`/compares/${encodeURIComponent(id)}/combine`, {})
      .then((r) => router.push({ pathname: '/thread/[id]', params: { id: r.id, cwd: data!.cwd } }), (e) => Alert.alert('Couldn’t start', e.message))
      .finally(() => setBusy(''));
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Comparison' }} />
      <ScrollView style={{ flex: 1, backgroundColor: c.bg as any }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
        {!!error && <Note error>{error}</Note>}
        {data && (
          <>
            <Text selectable style={[type.callout, { fontWeight: '600' }]}>{data.prompt}</Text>
            {data.runs.map((r, i) => (
              <RunCard key={r.thread ?? i} r={r} kept={!!r.thread && data.kept === r.thread} busy={busy === r.thread} onKeep={() => keep(r)} />
            ))}
            <Button icon="arrow.triangle.merge" label={busy === 'combine' ? 'Starting…' : 'Combine the best with Claude'} busy={busy === 'combine'} disabled={!!working || data.runs.filter((r) => r.worktree).length < 2} onPress={combine} />
            <Text style={[type.footnote, { textAlign: 'center' }]}>{working ? 'Keep and combine wait until every agent is done.' : 'A new thread in your checkout reads every run’s changes and merges the best of them.'}</Text>
          </>
        )}
      </ScrollView>
    </>
  );
}

function RunCard({ r, kept, busy, onKeep }: { r: CompareRun; kept: boolean; busy: boolean; onKeep: () => void }) {
  useHex();
  const live = r.status === 'working' || r.status === 'waiting';
  const open = () => r.thread && r.worktree && void openThread({ provider: r.provider, cwd: r.worktree, resume: r.session ?? r.thread });
  return (
    <View style={[card, { padding: 13, gap: 10, borderColor: kept ? c.green : c.line }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <ProviderIcon p={r.provider} size={30} />
        <View style={{ flex: 1 }}>
          <Text style={type.headline}>{providerName(r.provider)}{r.model ? ` · ${r.model}` : ''}</Text>
          <Text style={type.caption}>{r.error ? 'Didn’t start' : `${label[r.status ?? 'ended']}${r.files ? ` · ${r.files} file${r.files === 1 ? '' : 's'} · +${r.added} −${r.removed}` : ' · no changes yet'}`}{kept ? ' · kept' : ''}</Text>
        </View>
        {live && <PulsingDot size={7} />}
      </View>
      {!!(r.error || r.reply) && <Text selectable style={type.footnote} numberOfLines={5}>{r.error || r.reply}</Text>}
      {!r.error && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Small icon="bubble.left.and.text.bubble.right" label="Open" onPress={open} />
          {!!r.files && <Small icon="arrow.triangle.branch" label="Diff" onPress={() => router.push({ pathname: '/diff', params: { cwd: r.worktree! } })} />}
          {!!r.files && !live && !kept && <Small icon="tray.and.arrow.down" label={busy ? 'Keeping…' : 'Keep'} accent onPress={onKeep} />}
        </View>
      )}
    </View>
  );
}

function Small({ icon, label, onPress, accent }: { icon: string; label: string; onPress: () => void; accent?: boolean }) {
  useHex();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: tint(accent ? 'accent' : 'text', pressed ? 0.2 : 0.08) })}>
      <Icon name={icon} size={13} color={accent ? c.accent : c.text} />
      <Text style={[type.footnote, { fontWeight: '600', color: accent ? c.accent : c.text }]}>{label}</Text>
    </Pressable>
  );
}
