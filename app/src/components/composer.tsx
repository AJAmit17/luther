import { useRef, useState, type ComponentRef } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { MenuView } from '@expo/ui/community/menu';
import * as Haptics from 'expo-haptics';
import { AttachmentStrip, type useAttachments } from '@/components/attachments';
import { Icon, MODES, c, mono, tint, type, useHex, useScheme } from '@/components/ui';
import type { Mode, Model, Provider } from '@/lib/protocol';
import { ModelPicker, modelName } from '@/components/model-picker';
import { ThinkingSheet, effortLabel } from '@/components/thinking-sheet';
import type { useVoice } from '@/lib/voice';

const Chip = ({ icon, mark, label, color = c.dim, bg }: { icon?: string; mark?: React.ReactNode; label: string; color?: any; bg?: any }) => {
  useHex();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: process.env.EXPO_OS === 'android' ? 12 : 6, borderRadius: 999, backgroundColor: bg }}>
      {mark ?? <Icon name={icon!} size={12} color={color} />}
      <Text numberOfLines={1} style={[type.caption, { fontFamily: mono, color, maxWidth: 150 }]}>{label}</Text>
    </View>
  );
};

function Round({ icon, onPress, disabled, label, tone = 'accent' }: { icon: string; onPress: () => void; disabled?: boolean; label: string; tone?: 'accent' | 'text' }) {
  useHex();
  const size = process.env.EXPO_OS === 'android' ? 48 : 34;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: disabled ? tint('text', 0.1) : tone === 'text' ? c.text : c.accent, opacity: pressed ? 0.75 : 1 })}
    >
      <Icon name={icon} size={process.env.EXPO_OS === 'android' ? 22 : 15} color={disabled ? c.faint : tone === 'text' ? c.bg : c.onAccent} />
    </Pressable>
  );
}

/** The rounded prompt card: attachments, a growing field, and a row of chips
 *  (+, agent, model, permissions) beside the mic and a round button that sends,
 *  or stops the running turn while there's nothing to send. */
export function Composer(p: {
  text: string;
  setText: (t: string) => void;
  placeholder: string;
  att: ReturnType<typeof useAttachments>;
  attach: boolean;
  provider?: Provider;
  model: string;
  models: Model[];
  setModel: (m: string) => void;
  mode: Mode;
  setMode: (m: Mode) => void;
  /** Effort and fast mode, in a thread (absent: no Thinking chip). */
  think?: { efforts: string[]; effort: string; setEffort: (e: string) => void; fast: string; fastNote: string; setFast: (on: boolean) => void };
  canSend: boolean;
  send: () => void;
  canStop: boolean;
  stop: () => void;
  voice: ReturnType<typeof useVoice>;
}) {
  const scheme = useScheme();
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [focused, setFocused] = useState(false);
  const [picking, setPicking] = useState(false);
  const [thinking, setThinking] = useState(false);
  const t = p.think;
  const showThink = !!t && (t.efforts.length > 0 || !!t.fast);
  const m = MODES.find((x) => x.id === p.mode) ?? MODES[0];
  const empty = !p.text.trim() && !p.att.items.length;
  const modeColor = p.mode === 'full' ? c.red : p.mode === 'ask' ? c.dim : c.accent;
  return (
    <View style={{ padding: 10, gap: 8, backgroundColor: c.card, borderRadius: process.env.EXPO_OS === 'android' ? 16 : 24, borderCurve: 'continuous', borderWidth: 1, borderColor: c.line }}>
      {p.attach && <AttachmentStrip items={p.att.items} onRemove={p.att.remove} />}
      <TextInput
        ref={input}
        value={p.voice.listening ? p.voice.heard : p.text}
        onChangeText={p.setText}
        editable={!p.voice.listening}
        placeholder={p.voice.listening ? 'Listening… let go to send' : p.placeholder}
        placeholderTextColor={c.faint as string}
        multiline
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[type.callout, { maxHeight: 7 * 22, paddingHorizontal: 6, paddingTop: 4, paddingBottom: 2 }]}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        {p.attach && (
          <MenuView
            colorScheme={scheme}
            actions={[
              { id: 'photos', title: 'Photo Library', image: 'photo.on.rectangle' },
              { id: 'camera', title: 'Take Photo', image: 'camera' },
              { id: 'files', title: 'Files', image: 'folder' },
            ]}
            onPressAction={({ nativeEvent }) => void p.att.pick(nativeEvent.event as 'photos' | 'camera' | 'files')}
          >
            <View accessibilityLabel="Attach" style={{ padding: 6 }}>
              <Icon name="plus" size={18} color={c.dim} />
            </View>
          </MenuView>
        )}
        <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center', gap: 2 }}>
          <Pressable onPress={() => setPicking(true)} accessibilityRole="button" accessibilityLabel="Model">
            <Chip icon="cpu" label={modelName(p.models, p.model) || 'Default model'} />
          </Pressable>
          {showThink && (
            <Pressable onPress={() => setThinking(true)} accessibilityRole="button" accessibilityLabel="Thinking">
              <Chip icon="brain" label={(t.effort ? effortLabel(t.effort) : 'Effort') + (t.fast === 'on' ? ' · Fast' : '')} />
            </Pressable>
          )}
          <MenuView
            colorScheme={scheme}
            title="Permissions"
            actions={MODES.map((x) => ({ id: x.id, title: p.provider === 'devin' && x.id === 'ask' ? 'Ask (read-only)' : x.label, image: x.icon as any, state: p.mode === x.id ? 'on' : 'off', attributes: x.id === 'full' ? { destructive: true } : undefined }))}
            onPressAction={({ nativeEvent }) => p.setMode(nativeEvent.event as Mode)}
          >
            <Chip icon={m.icon} label={p.provider === 'devin' && p.mode === 'ask' ? 'Ask (read-only)' : m.label} color={modeColor} bg={p.mode === 'ask' ? undefined : tint(p.mode === 'full' ? 'red' : 'accent', 0.12)} />
          </MenuView>
        </ScrollView>
        {focused && (
          <Pressable onPress={() => input.current?.blur()} accessibilityLabel="Hide keyboard" style={{ padding: 6 }}>
            <Icon name="keyboard.chevron.compact.down" size={18} color={c.dim} />
          </Pressable>
        )}
        {empty && (
          <Pressable
            onPressIn={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              void p.voice.start();
            }}
            onPressOut={p.voice.stop}
            accessibilityLabel="Hold to talk"
            hitSlop={6}
            style={{ padding: 6, transform: [{ scale: p.voice.listening ? 1.25 : 1 }] }}
          >
            <Icon name={p.voice.listening ? 'waveform' : 'mic'} size={19} color={p.voice.listening ? c.red : c.dim} />
          </Pressable>
        )}
        {p.canStop && empty ? (
          <Round icon="stop.fill" label="Stop" tone="text" onPress={p.stop} />
        ) : (
          <Round icon="arrow.up" label="Send" onPress={p.send} disabled={!p.canSend} />
        )}
      </View>
      {showThink && <ThinkingSheet open={thinking} onClose={() => setThinking(false)} {...t} />}
      <ModelPicker open={picking} models={p.models} selected={p.model} onPick={p.setModel} onClose={() => setPicking(false)} />
    </View>
  );
}
