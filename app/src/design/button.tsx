import { ActivityIndicator } from 'react-native';
import type { IconName } from './icons';
import { Icon, Press } from './primitives';
import { Text } from './text';
import { TONE, tint, useTheme, type Tone } from './theme';
import { radius, shadow, size as sizes, space } from './tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive';

export function Button({ label, onPress, variant = 'secondary', size = 'md', icon, busy, disabled }: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  icon?: IconName;
  busy?: boolean;
  disabled?: boolean;
}) {
  const { color } = useTheme();
  const look = {
    primary: { bg: color.accent, fg: color.onAccent },
    secondary: { bg: color.muted, fg: color.text },
    tertiary: { bg: 'transparent', fg: color.text },
    destructive: { bg: tint(color.red, 0.12), fg: color.red },
  }[variant];
  const small = size === 'sm';
  return (
    <Press
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      scale={variant === 'primary' ? 0.995 : 0.98}
      style={[
        { flexDirection: 'row', gap: space.sm, alignItems: 'center', justifyContent: 'center', minHeight: small ? sizes.control : sizes.row, paddingHorizontal: small ? space.md : space.xl, borderRadius: radius.control, borderCurve: 'continuous', backgroundColor: look.bg },
        variant === 'primary' && { boxShadow: shadow.accent },
        (disabled || busy) && { opacity: 0.5 },
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={look.fg} /> : icon ? <Icon name={icon} size={small ? 14 : 16} color={look.fg} /> : null}
      <Text variant={small ? 'subhead' : 'headline'} weight="medium" style={{ color: look.fg }}>{label}</Text>
    </Press>
  );
}

/** A round icon-only button; `label` is what screen readers say. */
export function IconButton({ icon, label, onPress, variant = 'plain', tone = 'neutral', size = sizes.control, disabled }: {
  icon: IconName;
  label: string;
  onPress: () => void;
  variant?: 'plain' | 'tinted' | 'filled';
  tone?: Tone;
  size?: number;
  disabled?: boolean;
}) {
  const { color } = useTheme();
  const hue = color[TONE[tone]];
  const bg = disabled ? tint(color.text, 0.1) : variant === 'filled' ? (tone === 'neutral' ? color.text : hue) : variant === 'tinted' ? (tone === 'neutral' ? color.muted : tint(hue, 0.12)) : 'transparent';
  const fg = disabled ? color.faint : variant === 'filled' ? (tone === 'neutral' ? color.bg : color.onAccent) : tone === 'neutral' ? color.text : hue;
  return (
    <Press
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={Math.max(0, (sizes.hit - size) / 2)}
      scale={0.94}
      dim={1}
      style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: bg }}
    >
      <Icon name={icon} size={Math.round(size * 0.48)} color={fg} />
    </Press>
  );
}
