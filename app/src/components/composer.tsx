import { useRef, useState, type ComponentRef } from 'react';
import { View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { AttachmentStrip, type useAttachments } from '@/components/attachments';
import { modelName } from '@/components/model-picker';
import { effortLabel, type ThinkingProps } from '@/components/thinking';
import { ThreadSheet } from '@/components/thread-sheet';
import { Chip, Icon, IconButton, MenuView, Press, TextInput, radius, space, type, useTheme } from '@/design';
import { modeOf } from '@/features/agents';
import type { Mode, Model, Provider, Usage } from '@/lib/protocol';
import type { useVoice } from '@/lib/voice';

/** The prompt card: attachments, a growing field, +, one pill for the thread's knobs (ThreadSheet),
 *  the mic, and a round button that sends, or stops the turn while there's nothing to send. */
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
  /** Effort and fast mode, in a thread (absent: no Thinking section). */
  think?: ThinkingProps;
  /** What the thread has used so far, shown in the sheet. */
  usage?: Usage | null;
  canSend: boolean;
  send: () => void;
  canStop: boolean;
  stop: () => void;
  voice: ReturnType<typeof useVoice>;
}) {
  const { color, scheme } = useTheme();
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [focused, setFocused] = useState(false);
  const [sheet, setSheet] = useState(false);
  const t = p.think;
  // One pill for the thread's knobs: model · effort · permissions (the sheet has the rest).
  const summary = [modelName(p.models, p.model) || 'Default', t?.effort ? effortLabel(t.effort) + (t.fast === 'on' ? ' Fast' : '') : '', modeOf(p.mode).short].filter(Boolean).join(' · ');
  const empty = !p.text.trim() && !p.att.items.length;
  return (
    <View style={{ padding: space.sm + 2, gap: space.sm, backgroundColor: color.card, borderRadius: radius.sheet, borderCurve: 'continuous', borderWidth: 1, borderColor: color.line }}>
      {p.attach && <AttachmentStrip items={p.att.items} onRemove={p.att.remove} />}
      <TextInput
        ref={input}
        value={p.voice.listening ? p.voice.heard : p.text}
        onChangeText={p.setText}
        editable={!p.voice.listening}
        placeholder={p.voice.listening ? 'Listening… let go to send' : p.placeholder}
        multiline
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{ fontSize: type.callout.fontSize, lineHeight: type.callout.lineHeight, maxHeight: 7 * 22, paddingHorizontal: space.xs + 2, paddingTop: space.xs, paddingBottom: 2 }}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        {p.attach && (
          <MenuView
            accessibilityLabel="Attach"
            colorScheme={scheme}
            actions={[
              { id: 'photos', title: 'Photo Library', image: 'photo.on.rectangle' },
              { id: 'camera', title: 'Take Photo', image: 'camera' },
              { id: 'files', title: 'Files', image: 'folder' },
            ]}
            onPressAction={({ nativeEvent }) => void p.att.pick(nativeEvent.event as 'photos' | 'camera' | 'files')}
          >
            <View style={{ padding: space.xs + 2 }}>
              <Icon name="plus" size={18} color={color.dim} />
            </View>
          </MenuView>
        )}
        <View style={{ flex: 1, minWidth: 0, flexDirection: 'row' }}>
          <Chip icon="slider.horizontal.3" label={summary} tone={p.mode === 'full' ? 'danger' : 'neutral'} onPress={() => setSheet(true)} accessibilityLabel={`Thread settings: ${summary}`} />
        </View>
        {focused && <IconButton icon="keyboard.chevron.compact.down" label="Hide keyboard" onPress={() => input.current?.blur()} />}
        {empty && (
          <Press
            onPressIn={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              void p.voice.start();
            }}
            onPressOut={p.voice.stop}
            accessibilityRole="button"
            accessibilityLabel="Hold to talk"
            hitSlop={6}
            scale={1}
            dim={1}
            style={{ padding: space.xs + 2, transform: [{ scale: p.voice.listening ? 1.25 : 1 }] }}
          >
            <Icon name={p.voice.listening ? 'waveform' : 'mic'} size={19} color={p.voice.listening ? color.red : color.dim} />
          </Press>
        )}
        {p.canStop && empty ? (
          <IconButton icon="stop.fill" label="Stop" variant="filled" onPress={p.stop} />
        ) : (
          <IconButton icon="arrow.up" label="Send" variant="filled" tone="accent" onPress={p.send} disabled={!p.canSend} />
        )}
      </View>
      <ThreadSheet open={sheet} onClose={() => setSheet(false)} provider={p.provider} model={p.model} models={p.models} setModel={p.setModel} mode={p.mode} setMode={p.setMode} think={t} usage={p.usage} />
    </View>
  );
}
