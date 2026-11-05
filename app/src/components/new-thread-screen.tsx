import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { api } from '@/lib/hosts';
import type { Mode, Provider, ProviderInfo } from '@/lib/protocol';
import { openThread } from '@/lib/threads';
import { Button, Icon, MODES, Note, c, home, providerIcon, useLoad } from '@/components/ui';

const Chip = ({ label, on, onPress, icon }: { label: string; on: boolean; onPress: () => void; icon?: string }) => (
  <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: on ? c.accent : c.card }}>
    {!!icon && <Icon name={icon} size={14} color={on ? '#fff' : c.text} />}
    <Text style={{ color: on ? '#fff' : c.text, fontWeight: '500' }}>{label}</Text>
  </Pressable>
);

// New thread in a folder: pick the agent, model and permission mode.
export default function NewThread() {
  const { cwd } = useLocalSearchParams<{ cwd: string }>();
  const { data: providers, error } = useLoad(() => api<ProviderInfo[]>('/providers'));
  const installed = (providers ?? []).filter((p) => p.installed);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [mode, setMode] = useState<Mode>('ask');
  const [busy, setBusy] = useState(false);
  const p = provider ?? installed[0]?.id ?? null;

  useEffect(() => {
    if (!p) return;
    let live = true;
    api<string[]>('/models?provider=' + p).then((m) => live && setModels(m), () => live && setModels([]));
    return () => {
      live = false;
    };
  }, [p]);

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
      <Text style={{ color: c.dim }} selectable>{home(cwd)}</Text>
      {!!error && <Note error>{error}</Note>}
      {providers && !installed.length && <Note error>Neither claude nor codex is installed on this Mac.</Note>}
      <Text style={{ color: c.dim, fontWeight: '600' }}>AGENT</Text>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {installed.map((x) => (
          <Chip key={x.id} label={x.name} icon={providerIcon(x.id)} on={p === x.id} onPress={() => { setProvider(x.id); setModel(''); }} />
        ))}
      </View>
      <Text style={{ color: c.dim, fontWeight: '600' }}>MODEL</Text>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Chip label="Default" on={!model} onPress={() => setModel('')} />
        {models.map((m) => <Chip key={m} label={m} on={model === m} onPress={() => setModel(m)} />)}
      </View>
      <Text style={{ color: c.dim, fontWeight: '600' }}>PERMISSIONS</Text>
      <View style={{ gap: 6 }}>
        {MODES.map((m) => (
          <Pressable key={m.id} onPress={() => setMode(m.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderCurve: 'continuous', backgroundColor: mode === m.id ? c.fill : c.card }}>
            <Icon name={m.icon} color={m.id === 'full' ? c.red : c.accent} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontWeight: '600' }}>{m.label}</Text>
              <Text style={{ color: c.dim, fontSize: 12 }}>{m.desc}</Text>
            </View>
            {mode === m.id && <Icon name="checkmark" color={c.accent} />}
          </Pressable>
        ))}
      </View>
      <Button
        kind="accent"
        label={busy ? 'Starting…' : 'Start'}
        disabled={!p || busy}
        onPress={() => {
          setBusy(true);
          openThread({ provider: p!, cwd, mode, model: model || undefined }, true).finally(() => setBusy(false));
        }}
      />
    </ScrollView>
  );
}
