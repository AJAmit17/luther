import type { ReactNode } from 'react';
import { View } from 'react-native';
import type { IconName } from './icons';
import { Icon, Press, StatusDot } from './primitives';
import { Text } from './text';
import { TONE, tint, useTheme, type Tone } from './theme';
import { radius, space } from './tokens';

/** A capsule you can tap: filters, quick actions, the composer's settings pill. */
export function Chip({ label, icon, leading, tone = 'neutral', selected, onPress, disabled, accessibilityLabel }: {
  label: string;
  icon?: IconName;
  leading?: ReactNode;
  tone?: Tone;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const { color } = useTheme();
  const hue = tone === 'neutral' ? color.text : color[TONE[tone]];
  const body = (
    <View
      style={[
        { flexDirection: 'row', alignItems: 'center', gap: space.xs + 2, height: 30, paddingHorizontal: space.md - 2, borderRadius: radius.full, backgroundColor: tone === 'neutral' ? color.muted : tint(hue, 0.12) },
        selected && { backgroundColor: tint(color.accent, 0.12), borderWidth: 1.5, borderColor: color.accent },
        disabled && { opacity: 0.5 },
      ]}
    >
      {leading ?? (icon ? <Icon name={icon} size={14} color={hue} /> : null)}
      <Text variant="footnote" weight="medium" numberOfLines={1} style={{ color: hue, maxWidth: 220 }}>{label}</Text>
    </View>
  );
  if (!onPress) return body;
  return (
    <Press onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ selected }} hitSlop={6}>
      {body}
    </Press>
  );
}

/** A state capsule: a dot (breathing while live) or an icon, and a word. */
export function Pill({ label, tone = 'neutral', live, icon }: { label: string; tone?: Tone; live?: boolean; icon?: IconName }) {
  const { color } = useTheme();
  const hue = tone === 'neutral' ? color.dim : color[TONE[tone]];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.full, backgroundColor: tint(hue, 0.14) }}>
      {icon ? <Icon name={icon} size={10} color={hue} /> : <StatusDot color={hue} live={live} />}
      <Text variant="caption2" weight="medium" style={{ color: hue }}>{label}</Text>
    </View>
  );
}
