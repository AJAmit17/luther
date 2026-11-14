import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Field, Note, SectionHeader, Text, alert, space, useTheme, SheetFooter, SheetHeader } from '@/design';
import { AgentPicker, ModePicker, loadProviders } from '@/features/agents';
import { post } from '@/lib/hosts';
import { home } from '@/lib/format';
import { useLoad } from '@/lib/use-load';
import type { Compare, Mode, Provider } from '@/lib/protocol';

const MAX = 5;

// Compare agents (a sheet): one prompt to two to five agents, each in its own
// worktree of this project.
export default function NewCompare() {
  const { color } = useTheme();
  const { cwd } = useLocalSearchParams<{ cwd: string }>();
  const { data: providers, error } = useLoad(loadProviders, [], 'providers');
  const installed = (providers ?? []).filter((p) => p.installed);
  const [picked, setPicked] = useState<Provider[]>([]);
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<Mode>('edits');
  const [busy, setBusy] = useState(false);
  const start = () => {
    setBusy(true);
    post<Compare>('/compares', { cwd, prompt, mode, runs: picked.map((provider) => ({ provider })) }).then(
      (c) => router.replace({ pathname: '/compare/[id]', params: { id: c.id } }),
      (e) => {
        setBusy(false);
        alert('Couldn’t start the comparison', e.message);
      },
    );
  };
  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={{ padding: space.lg + space.xs, paddingTop: space.xl + space.xs, gap: space.lg + space.xs }}>
        <SheetHeader title="Compare Agents" subtitle={`${home(cwd)} · each in its own worktree`} />
        {!!error && <Note tone="danger">{error}</Note>}
        <Field lines={4} value={prompt} onChangeText={setPrompt} placeholder="The task, e.g. Add retries with backoff to the payment webhook" />
        <View style={{ gap: space.sm }}>
          <SectionHeader title="Agents" trailing={picked.length ? <Text variant="footnote" weight="medium" style={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>{picked.length} picked</Text> : undefined} />
          <AgentPicker
            multiple
            agents={installed.map((x) => x.id)}
            details={Object.fromEntries(installed.map((x) => [x.id, x.version || 'installed']))}
            value={picked}
            onChange={(next) => next.length <= MAX && setPicked(next)}
          />
          <Text variant="footnote" style={{ paddingHorizontal: space.xs }}>Same prompt for each, without touching each other or your checkout. Then keep the best result, or have an agent combine them.</Text>
        </View>
        <View style={{ gap: space.sm }}>
          <SectionHeader title="Permissions" />
          <ModePicker value={mode} onChange={setMode} />
        </View>
      </ScrollView>
      <SheetFooter>
        <View style={{ flex: 1 }}>
          <Button
            variant="primary"
            label={busy ? 'Starting…' : picked.length < 2 ? 'Pick at Least Two Agents' : `Start ${picked.length} Runs`}
            busy={busy}
            disabled={!prompt.trim() || picked.length < 2}
            onPress={start}
          />
        </View>
      </SheetFooter>
    </View>
  );
}
