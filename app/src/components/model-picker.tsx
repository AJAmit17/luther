import { useEffect, useMemo, useState } from 'react';
import { Modal, SectionList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, Press, Text, TextInput, radius, space, useTheme } from '@/design';
import { api } from '@/lib/hosts';
import type { Model, Provider } from '@/lib/protocol';

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
  const { color } = useTheme();
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
      <View style={{ flex: 1, backgroundColor: color.surface, paddingTop: process.env.EXPO_OS === 'android' ? insets.top : 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xl - 4, paddingTop: space.lg + 2, paddingBottom: space.sm + 2 }}>
          <Text variant="title3" style={{ flex: 1 }}>Model</Text>
          <Press onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <Text variant="headline" color="accent">Done</Text>
          </Press>
        </View>
        {models.length > 12 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginHorizontal: space.lg, marginBottom: space.sm, paddingHorizontal: space.md, borderRadius: radius.card, backgroundColor: color.muted }}>
            <Icon name="magnifyingglass" size={15} color={color.dim} />
            <TextInput value={q} onChangeText={setQ} placeholder={`Search ${models.length} models`} autoCorrect={false} autoCapitalize="none" style={{ flex: 1, paddingVertical: space.sm + 2 }} />
          </View>
        )}
        <SectionList
          sections={sections}
          keyExtractor={(m) => m.id || 'default'}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingBottom: space.xl + insets.bottom }}
          ListEmptyComponent={<Text variant="subhead" color="dim" style={{ textAlign: 'center', padding: space.xxl }}>{models.length ? 'No model matches.' : 'Asking the agent for its models…'}</Text>}
          renderSectionHeader={({ section }) =>
            section.title ? (
              <Text variant="footnote" weight="medium" style={{ textTransform: 'uppercase', paddingHorizontal: space.xl - 4, paddingTop: space.lg + 2, paddingBottom: space.xs + 2 }}>{section.title}</Text>
            ) : null
          }
          renderItem={({ item: m }) => (
            <Press onPress={() => pick(m.id)} scale={1} accessibilityRole="button" accessibilityState={{ selected: isOn(m) }} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.xl - 4, paddingVertical: space.md }}>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text color={isOn(m) ? 'accent' : undefined} weight={isOn(m) ? 'medium' : undefined} numberOfLines={1}>{m.name}</Text>
                {!!(m.desc || (m.id && m.id !== m.name)) && <Text variant="footnote" numberOfLines={1}>{m.desc || m.id}</Text>}
              </View>
              {isOn(m) && <Icon name="checkmark" size={16} color={color.accent} />}
            </Press>
          )}
        />
      </View>
    </Modal>
  );
}
