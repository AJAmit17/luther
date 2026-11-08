import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, post } from '@/lib/hosts';
import type { Compare, Mode, Provider, ProviderInfo } from '@/lib/protocol';
import { Button, Group, GroupRow, Icon, MODES, Note, ProviderIcon, c, card, home, tint, type, useLoad, useHex } from '@/components/ui';

// Compare agents (a sheet): one prompt to two to five agents, each in its own
// worktree of this project.
export default function NewCompare() {
  useHex();
  const insets = useSafeAreaInsets();
  const { cwd } = useLocalSearchParams<{ cwd: string }>();
  const { data: providers, error } = useLoad(() => api<ProviderInfo[]>('/providers'), [], 'providers');
  const installed = (providers ?? []).filter((p) => p.installed);
  const [picked, setPicked] = useState<Provider[]>([]);
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<Mode>('edits');
  const [busy, setBusy] = useState(false);
  const toggle = (p: Provider) => setPicked((x) => (x.includes(p) ? x.filter((y) => y !== p) : x.length < 5 ? [...x, p] : x));
  const start = () => {
    setBusy(true);
    post<Compare>('/compares', { cwd, prompt, mode, runs: picked.map((provider) => ({ provider })) }).then(
      (c) => router.replace({ pathname: '/compare/[id]', params: { id: c.id } }),
      (e) => {
        setBusy(false);
        Alert.alert('Couldn’t start the comparison', e.message);
      },
    );
  };
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.surface }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingTop: 28, gap: 20, paddingBottom: 40 + insets.bottom }}>
      <View style={{ gap: 4 }}>
        <Text style={type.title2}>Compare agents</Text>
        <Text selectable style={type.footnote} numberOfLines={1}>{home(cwd)}</Text>
        <Text style={type.footnote}>Each agent gets the same prompt in its own worktree, so they don’t touch each other or your checkout. Then keep the best result, or have an agent combine them.</Text>
      </View>
      {!!error && <Note error>{error}</Note>}
      <TextInput
        value={prompt}
        onChangeText={setPrompt}
        multiline
        placeholder="The task, e.g. Add retries with backoff to the payment webhook"
        placeholderTextColor={c.dim}
        style={{ minHeight: 100, color: c.text, backgroundColor: c.card, borderRadius: 14, borderCurve: 'continuous', padding: 14, fontSize: 16, textAlignVertical: 'top' }}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {installed.map((x) => {
          const on = picked.includes(x.id);
          return (
            <Pressable key={x.id} onPress={() => toggle(x.id)} style={({ pressed }) => [card, { width: '47%', flexGrow: 1, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderColor: on ? c.accent : c.line, borderWidth: on ? 1.5 : 1, backgroundColor: on ? tint('accent', 0.08) : c.card, opacity: pressed ? 0.8 : 1 }]}>
              <ProviderIcon p={x.id} size={28} />
              <Text style={[type.headline, { flex: 1 }]} numberOfLines={1}>{x.name}</Text>
              <Icon name={on ? 'checkmark.circle.fill' : 'circle'} size={18} color={on ? c.accent : c.faint} />
            </Pressable>
          );
        })}
      </View>
      <Group title="Permissions">
        {MODES.map((m, i) => (
          <GroupRow key={m.id} first={i === 0} icon={m.icon} iconColor={m.id === 'full' ? c.red : c.accent} label={m.label} sub={m.desc} right={mode === m.id ? <Icon name="checkmark" size={15} color={c.accent} /> : <View style={{ width: 15 }} />} onPress={() => setMode(m.id)} />
        ))}
      </Group>
      <Button kind="accent" icon="play.fill" label={busy ? 'Starting…' : picked.length < 2 ? 'Pick at least two agents' : `Start ${picked.length} agents`} busy={busy} disabled={!prompt.trim() || picked.length < 2} onPress={start} />
    </ScrollView>
  );
}
