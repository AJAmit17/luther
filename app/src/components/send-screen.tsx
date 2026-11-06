import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { api } from '@/lib/hosts';
import type { Project, Provider, ProviderInfo } from '@/lib/protocol';
import { openThread } from '@/lib/threads';
import { Icon, Note, Row, c, home, useLoad, listStyle, ProviderMark } from '@/components/ui';

// "Send to Luther": a message (from a Shortcut, Siri, the Share Sheet via a
// Shortcut, a widget, or the home-screen icon's menu) to a new thread in a
// project. luther://send?text=…[&cwd=…][&provider=…] — with cwd it goes
// straight there.
export default function Send() {
  const params = useLocalSearchParams<{ text?: string; cwd?: string; provider?: Provider }>();
  const [text, setText] = useState(params.text ?? '');
  const { data: projects, error } = useLoad(() => api<Project[]>('/projects'), [], 'projects');
  const { data: providers } = useLoad(() => api<ProviderInfo[]>('/providers'), [], 'providers');
  const installed = (providers ?? []).filter((p) => p.installed);
  const [picked, setPicked] = useState<Provider | null>(params.provider ?? null);
  const provider = picked ?? installed[0]?.id ?? 'claude';
  const [busy, setBusy] = useState('');

  const go = (cwd: string) => {
    setBusy(cwd);
    openThread({ provider, cwd }, true, text.trim() || undefined).finally(() => setBusy(''));
  };
  const direct = useRef(false);
  useEffect(() => {
    if (params.cwd && providers && !direct.current) {
      direct.current = true; // once: a failure stays on this screen
      go(params.cwd);
    }
  }, [params.cwd, providers]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Stack.Screen options={{ title: 'Send to Luther' }} />
      <FlatList
        contentContainerStyle={listStyle}
        style={{ flex: 1, backgroundColor: c.bg as any }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        data={projects ?? []}
        keyExtractor={(p) => p.cwd}
        ListHeaderComponent={
          <View style={{ padding: 16, gap: 12 }}>
            <TextInput
              style={{ color: c.text, backgroundColor: c.card, borderRadius: 14, borderCurve: 'continuous', padding: 12, fontSize: 16, minHeight: 90 }}
              value={text}
              onChangeText={setText}
              placeholder="What should the agent do?"
              placeholderTextColor={c.dim}
              multiline
              autoFocus={!params.text}
            />
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {installed.map((p) => (
                <Pressable key={p.id} onPress={() => setPicked(p.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: provider === p.id ? c.accent : c.card }}>
                  <ProviderMark p={p.id} size={14} color={provider === p.id ? c.onAccent : undefined} />
                  <Text style={{ color: provider === p.id ? c.onAccent : c.text, fontWeight: '500' }}>{p.name}</Text>
                </Pressable>
              ))}
            </View>
            {!!error && <Note error>{error}</Note>}
            <Text style={{ color: c.dim, fontSize: 13, fontWeight: '600' }}>PICK A PROJECT</Text>
          </View>
        }
        renderItem={({ item: p }) => (
          <Row
            icon={<Icon name="folder" size={22} color={c.blue} />}
            title={p.name}
            sub={home(p.cwd)}
            right={busy === p.cwd ? <Text style={{ color: c.dim }}>Starting…</Text> : <Icon name="paperplane" size={16} color={c.accent} />}
            onPress={() => !busy && go(p.cwd)}
          />
        )}
        ListFooterComponent={
          <Note>
            Tip: in Shortcuts, make one that opens luther://send?text=[Shortcut Input] and turn on “Show in Share Sheet”. Then share any text to Luther, or say its name to Siri.
          </Note>
        }
      />
    </>
  );
}
