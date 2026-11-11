import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, View, type DimensionValue } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import type { IconName } from './icons';
import { Icon, Press, Surface } from './primitives';
import { Text } from './text';
import { TONE, tint, useTheme, type Tone } from './theme';
import { motion, radius, space } from './tokens';

/** What a list shows when there is nothing in it: art or an icon, a title, the next step. */
export function EmptyState({ icon, art, title, message, action }: { icon?: IconName; art?: ReactNode; title: string; message?: string; action?: ReactNode }) {
  const { color } = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: space.sm, paddingHorizontal: space.xxl, paddingVertical: space.xxl + space.lg }}>
      {art ?? (icon ? <Icon name={icon} size={44} color={color.faint} /> : null)}
      <Text variant="title3" style={{ textAlign: 'center', marginTop: space.sm }}>{title}</Text>
      {!!message && <Text variant="callout" color="dim" style={{ textAlign: 'center' }}>{message}</Text>}
      {!!action && <View style={{ marginTop: space.md }}>{action}</View>}
    </View>
  );
}

/** A line of explanation; `danger` makes it an error box. */
export function Note({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'danger' }) {
  const { color } = useTheme();
  if (tone === 'neutral') return <Text selectable variant="footnote" style={{ textAlign: 'center', padding: space.md }}>{children}</Text>;
  return (
    <View accessibilityRole="alert" style={{ flexDirection: 'row', gap: space.sm, padding: space.md, borderRadius: radius.card, borderCurve: 'continuous', backgroundColor: tint(color.red, 0.1) }}>
      <Icon name="exclamationmark.triangle.fill" size={15} color={color.red} />
      <Text selectable variant="footnote" color="red" style={{ flex: 1 }}>{children}</Text>
    </View>
  );
}

/** A slim status strip across the top of a screen. */
export function Banner({ text, tone = 'neutral', icon, onPress, action }: { text: string; tone?: Tone; icon?: IconName; onPress?: () => void; action?: string }) {
  const { color } = useTheme();
  const hue = tone === 'neutral' ? color.dim : color[TONE[tone]];
  return (
    <Press onPress={onPress} disabled={!onPress} scale={1} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs + 2, paddingVertical: space.sm, paddingHorizontal: space.lg, backgroundColor: tone === 'neutral' ? color.muted : tint(hue, 0.12) }}>
      {!!icon && <Icon name={icon} size={13} color={hue} />}
      <Text selectable variant="footnote" style={{ color: hue, flexShrink: 1 }}>{text}</Text>
      {!!action && <Text variant="footnote" weight="medium" style={{ color: hue }}>{action}</Text>}
    </Press>
  );
}

export function Spinner({ size = 'small' }: { size?: 'small' | 'large' }) {
  const { color } = useTheme();
  return <ActivityIndicator size={size} color={color.dim} />;
}

/** A placeholder block that breathes while the real content loads. */
export function Skeleton({ width = '100%', height = 12, round = 6 }: { width?: DimensionValue; height?: number; round?: number }) {
  const { color } = useTheme();
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(withRepeat(withTiming(1, { duration: motion.pulse, easing: Easing.inOut(Easing.ease) }), -1, true));
  }, [t]);
  const breathe = useAnimatedStyle(() => ({ opacity: 1 - t.get() * 0.45 }));
  return <Animated.View style={[{ width, height, borderRadius: round, backgroundColor: color.muted }, breathe]} />;
}

const WIDTHS: [DimensionValue, DimensionValue][] = [['62%', '80%'], ['48%', '66%'], ['70%', '74%'], ['55%', '58%'], ['40%', '70%']];

/** Rows of placeholders in the shape of list rows. */
export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <View accessibilityLabel="Loading" style={{ gap: space.sm }}>
      {Array.from({ length: rows }, (_, i) => (
        <Surface key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md + 2 }}>
          <Skeleton width={36} height={36} round={11} />
          <View style={{ flex: 1, gap: space.sm }}>
            <Skeleton width={WIDTHS[i % WIDTHS.length][0]} height={12} />
            <Skeleton width={WIDTHS[i % WIDTHS.length][1]} height={10} />
          </View>
        </Surface>
      ))}
    </View>
  );
}
