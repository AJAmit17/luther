import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, SectionList, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '@/lib/hosts';
import type { Model, Provider } from '@/lib/protocol';
import { Icon, c, type, useHex } from '@/components/ui';

/** An agent's models, as it lists them itself (the Mac keeps the lists, so they
 *  come at once, before any session). */
export function useModels(provider?: Provider | null) {
  const [models, setModels] = useState<Model[]>([]);
  useEffect(() => {
    if (!provider) return;
    let live = true;
    api<Model[]>('/models?provider=' + provider).then(
      (m) => live && setModels(m),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [provider]);
  return models;
}

/** A model's name ("Opus 5.5") for an ID a session reports, alias or full. */
export const modelName = (models: Model[], id: string) => (id ? (models.find((m) => m.id === id || m.resolved === id)?.name ?? id) : '');

/** Choose a model: a sheet with the agent's models, grouped, searchable when
 *  the list is long (OpenCode and Oh My Pi list hundreds). */
export function ModelPicker({ open, models, selected, onPick, onClose, withDefault }: {
  open: boolean;
  models: Model[];
  selected: string;
  onPick: (id: string) => void;
  onClose: () => void;
  withDefault?: boolean;
}) {
  const h = useHex();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const sections = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const shown = models.filter((m) => !needle || `${m.name} ${m.id} ${m.group ?? ''}`.toLowerCase().includes(needle));
    const groups = new Map<string, Model[]>();
    for (const m of shown) groups.set(m.group ?? '', [...(groups.get(m.group ?? '') ?? []), m]);
    const out = [...groups].map(([title, data]) => ({ title, data }));
    if (withDefault && !needle) out.unshift({ title: '', data: [{ id: '', name: 'Default', desc: 'The agent picks; you can switch later' }] });
    return out;
  }, [models, q, withDefault]);
  const isOn = (m: Model) => (m.id ? m.id === selected || m.resolved === selected : !selected);
  const pick = (id: string) => {
    onPick(id);
    onClose();
    setQ('');
  };

  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: h.surface, paddingTop: process.env.EXPO_OS === 'android' ? insets.top : 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10 }}>
          <Text style={[type.title3, { flex: 1 }]}>Model</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <Text style={[type.headline, { color: c.accent }]}>Done</Text>
          </Pressable>
        </View>
        {models.length > 12 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: c.muted }}>
            <Icon name="magnifyingglass" size={15} color={c.dim} />
            <TextInput value={q} onChangeText={setQ} placeholder={`Search ${models.length} models`} placeholderTextColor={c.faint} autoCorrect={false} autoCapitalize="none" style={[type.body, { flex: 1, paddingVertical: 10 }]} />
          </View>
        )}
        <SectionList
          sections={sections}
          keyExtractor={(m) => m.id || 'default'}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingBottom: 24 + insets.bottom }}
          ListEmptyComponent={<Text style={[type.subhead, { color: c.dim, textAlign: 'center', padding: 32 }]}>{models.length ? 'No model matches.' : 'Asking the agent for its models…'}</Text>}
          renderSectionHeader={({ section }) => (section.title ? <Text style={[type.footnote, { fontWeight: '600', textTransform: 'uppercase', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 6 }]}>{section.title}</Text> : null)}
          renderItem={({ item: m }) => (
            <Pressable onPress={() => pick(m.id)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 12, backgroundColor: pressed ? c.muted : 'transparent' })}>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text style={[type.body, isOn(m) && { color: c.accent, fontWeight: '600' }]} numberOfLines={1}>{m.name}</Text>
                {!!(m.desc || (m.id && m.id !== m.name)) && <Text style={type.footnote} numberOfLines={1}>{m.desc || m.id}</Text>}
              </View>
              {isOn(m) && <Icon name="checkmark" size={16} color={c.accent} />}
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}
