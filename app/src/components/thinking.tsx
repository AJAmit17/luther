import { useState } from 'react';
import { View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { EffortSlider } from '@/components/effort-slider';
import { Icon, Press, Surface, Text, space, tint, useTheme, type IconName } from '@/design';
import type { Model, State } from '@/lib/protocol';

const LABEL: Record<string, string> = { minimal: 'Min', low: 'Low', medium: 'Med', high: 'High', xhigh: 'XHigh', max: 'Max', auto: 'Auto', off: 'Off' };
export const effortLabel = (e: string) => LABEL[e] ?? e.charAt(0).toUpperCase() + e.slice(1);

/** What a thread can tune: the agent's effort levels (per session for ACP
 *  agents, else the current model's) and its fast mode. */
export function knobs(st: State | null | undefined, models: Model[]) {
  const m = models.find((x) => x.id === st?.model || x.resolved === st?.model) ?? (st?.model ? undefined : models[0]);
  const efforts = st?.efforts?.length ? st.efforts : (m?.efforts ?? []);
  const fast = st?.fast || (!st?.fastNote && m?.fast ? 'off' : '');
  return { efforts, effort: st?.effort || m?.effort || '', fast, fastNote: st?.fastNote ?? '' };
}

// The slider's thumb stops this far in from each end (iOS's and the shared one).
const INSET = 14;

export type ThinkingProps = {
  efforts: string[];
  effort: string;
  setEffort: (e: string) => void;
  fast: string;
  fastNote: string;
  setFast: (on: boolean) => void;
};

/** Effort levels on a stepped slider, then Thinking and Fast toggles; changes apply
 *  from the next request. Drawn inside the thread sheet. */
export function Thinking(p: ThinkingProps) {
  const { color } = useTheme();
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

  const tile = (icon: IconName, title: string, sub: string, on: boolean, onPress?: () => void) => {
    const body = (
      <Surface style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm + 2, padding: space.md }}>
        <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? color.accent : tint(color.text, 0.08) }}>
          <Icon name={icon} size={17} color={on ? color.onAccent : onPress ? color.text : color.faint} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="subhead" weight="medium" color={onPress ? undefined : 'dim'} numberOfLines={1}>{title}</Text>
          <Text variant="caption" color={on ? 'accent' : undefined} numberOfLines={2}>{sub}</Text>
        </View>
      </Surface>
    );
    if (!onPress)
      return (
        <View accessible accessibilityLabel={`${title}: ${sub}`} style={{ flex: 1 }}>
          {body}
        </View>
      );
    return (
      <Press onPress={onPress} accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={`${title}: ${sub}`} style={{ flex: 1 }}>
        {body}
      </Press>
    );
  };

  return (
    <View style={{ gap: space.sm + 2 }}>
      {stops.length > 1 ? (
        <Surface style={{ paddingVertical: space.md + 2, paddingHorizontal: space.md, gap: space.xs + 2, opacity: thinking ? 1 : 0.45 }} pointerEvents={thinking ? 'auto' : 'none'}>
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
            <Text variant="footnote" style={{ textAlign: 'center', paddingVertical: space.xs + 2 }}>Using the Mac’s default; it shows here after the first reply. Tap a level to choose one.</Text>
          )}
          <View style={{ height: 22, marginHorizontal: INSET }}>
            {stops.map((s, i) => (
              <Press key={s} onPress={() => set(s)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Effort ${effortLabel(s)}`} style={{ position: 'absolute', left: `${(i / (stops.length - 1)) * 100}%`, width: 64, marginLeft: -32, alignItems: 'center' }}>
                <Text variant="subhead" color={i === at ? 'accent' : 'dim'} weight={i === at ? 'medium' : undefined}>{effortLabel(s)}</Text>
              </Press>
            ))}
          </View>
        </Surface>
      ) : (
        <Surface style={{ padding: space.lg }}>
          <Text variant="footnote" style={{ textAlign: 'center' }}>This agent doesn’t offer effort levels.</Text>
        </Surface>
      )}
      <View style={{ flexDirection: 'row', gap: space.sm + 2 }}>
        {canOff
          ? tile('brain', 'Thinking', thinking ? 'On' : 'Off', thinking, () => p.setEffort(thinking ? 'off' : firstOn))
          : tile('brain', 'Thinking', stops.length ? 'Always on for this model' : 'Not offered', false)}
        {p.fast
          ? tile('bolt.fill', 'Fast', p.fast === 'on' ? 'On' : 'Off', p.fast === 'on', () => p.setFast(p.fast !== 'on'))
          : tile('bolt.fill', 'Fast', p.fastNote || 'Not available', false)}
      </View>
    </View>
  );
}
