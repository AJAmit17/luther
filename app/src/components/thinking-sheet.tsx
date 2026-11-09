import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { EffortSlider } from '@/components/effort-slider';
import { Icon, c, card, tint, type, useHex } from '@/components/ui';
import type { Model, State } from '@/lib/protocol';

const LABEL: Record<string, string> = { minimal: 'Min', low: 'Low', medium: 'Med', high: 'High', xhigh: 'XHigh', max: 'Max', auto: 'Auto', off: 'Off' };
export const effortLabel = (e: string) => LABEL[e] ?? e.charAt(0).toUpperCase() + e.slice(1);

/** What a thread can tune now: the agent's effort levels (per session for ACP
 *  agents, else the current model's) and its fast mode. */
export function knobs(st: State | null | undefined, models: Model[]) {
  const m = models.find((x) => x.id === st?.model || x.resolved === st?.model) ?? (st?.model ? undefined : models[0]);
  const efforts = st?.efforts?.length ? st.efforts : (m?.efforts ?? []);
  const fast = st?.fast || (!st?.fastNote && m?.fast ? 'off' : '');
  return { efforts, effort: st?.effort || m?.effort || '', fast, fastNote: st?.fastNote ?? '' };
}

// The native slider's thumb stops this far in from each end.
const INSET = process.env.EXPO_OS === 'ios' ? 14 : 10;

/** Thinking: the agent's effort levels on a native stepped slider, then whether
 *  it can think less (Thinking) or answer faster (Fast). Changes apply from the
 *  next request. */
export function ThinkingSheet(p: {
  open: boolean;
  onClose: () => void;
  efforts: string[];
  effort: string;
  setEffort: (e: string) => void;
  fast: string;
  fastNote: string;
  setFast: (on: boolean) => void;
}) {
  useHex();
  const insets = useSafeAreaInsets();
  const [moving, setMoving] = useState<number | null>(null);
  const stops = p.efforts.filter((e) => e !== 'off');
  const canOff = p.efforts.includes('off');
  const thinking = p.effort !== 'off';
  const at = moving ?? stops.indexOf(p.effort);
  // Not known yet (a new Claude thread before its first reply): no thumb, so
  // the slider never claims a level the agent isn't using.
  const known = stops.includes(p.effort);
  const firstOn = stops.includes('auto') ? 'auto' : (stops[Math.floor(stops.length / 2)] ?? '');
  const set = (e: string) => {
    setMoving(null);
    p.setEffort(e);
  };

  const tile = (icon: string, title: string, sub: string, on: boolean, onPress?: () => void) => (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'switch' : 'text'}
      accessibilityState={onPress ? { checked: on } : undefined}
      accessibilityLabel={`${title}: ${sub}`}
      style={({ pressed }) => [card, { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.accent : tint('text', 0.08) }}>
        <Icon name={icon} size={17} color={on ? c.onAccent : onPress ? c.text : c.faint} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.subhead, { fontWeight: '600' }, !onPress && { color: c.dim }]} numberOfLines={1}>{title}</Text>
        <Text style={[type.caption, on && { color: c.accent }]} numberOfLines={2}>{sub}</Text>
      </View>
    </Pressable>
  );

  return (
    <Modal visible={p.open} transparent animationType="slide" onRequestClose={p.onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: '#0006' }} onPress={p.onClose} accessibilityLabel="Close" />
      <View style={{ backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderCurve: 'continuous', padding: 16, paddingBottom: 16 + insets.bottom, gap: 12 }}>
        <Text style={[type.footnote, { fontWeight: '600', letterSpacing: 1.2, textTransform: 'uppercase', paddingHorizontal: 4 }]}>Thinking</Text>
        {stops.length > 1 ? (
          <View style={[card, { paddingVertical: 14, paddingHorizontal: 12, gap: 6, opacity: thinking ? 1 : 0.45 }]} pointerEvents={thinking ? 'auto' : 'none'}>
            {known ? (
              <EffortSlider
                stops={stops}
                value={p.effort}
                onChange={set}
                onMove={(i) => {
                  if (i !== moving) void Haptics.selectionAsync();
                  setMoving(i);
                }}
              />
            ) : (
              <Text style={[type.footnote, { textAlign: 'center', paddingVertical: 6 }]}>Using the Mac’s default; it shows here after the first reply. Tap a level to choose one.</Text>
            )}
            <View style={{ height: 22, marginHorizontal: INSET }}>
              {stops.map((s, i) => (
                <Pressable key={s} onPress={() => set(s)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Effort ${effortLabel(s)}`} style={{ position: 'absolute', left: `${(i / (stops.length - 1)) * 100}%`, width: 64, marginLeft: -32, alignItems: 'center' }}>
                  <Text style={[type.footnote, { fontSize: 14 }, i === at && { color: c.accent, fontWeight: '600' }]}>{effortLabel(s)}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <View style={[card, { padding: 16 }]}>
            <Text style={[type.footnote, { textAlign: 'center' }]}>This agent doesn’t offer effort levels.</Text>
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {canOff
            ? tile('brain', 'Thinking', thinking ? 'On' : 'Off', thinking, () => p.setEffort(thinking ? 'off' : firstOn))
            : tile('brain', 'Thinking', stops.length ? 'Always on for this model' : 'Not offered', false)}
          {p.fast
            ? tile('bolt.fill', 'Fast', p.fast === 'on' ? 'On' : 'Off', p.fast === 'on', () => p.setFast(p.fast !== 'on'))
            : tile('bolt.fill', 'Fast', p.fastNote || 'Not available', false)}
        </View>
      </View>
    </Modal>
  );
}
