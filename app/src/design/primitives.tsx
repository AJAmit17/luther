import { useEffect } from 'react';
import { Pressable, View, type PressableProps, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { ICONS, type IconName } from './icons';
import { useTheme, type Palette } from './theme';
import { motion, radius } from './tokens';

export function Icon({ name, size = 18, color }: { name: IconName; size?: number; color?: string }) {
  const theme = useTheme();
  const { icon: Glyph, fill } = ICONS[name] as { icon: (typeof ICONS)[IconName]['icon']; fill?: true };
  return <Glyph size={size} color={color ?? theme.color.dim} weight={fill ? 'fill' : 'regular'} />;
}

const APressable = Animated.createAnimatedComponent(Pressable);

export type PressProps = Omit<PressableProps, 'style'> & { style?: StyleProp<ViewStyle>; scale?: number; dim?: number };

/** Every tap in the app: sinks a little while held, on the UI thread. Controls that look disabled dim themselves. */
export function Press({ style, scale = 0.98, dim = 0.85, disabled, onPressIn, onPressOut, ...p }: PressProps) {
  const down = useSharedValue(0);
  const sink = useAnimatedStyle(() => ({ opacity: 1 - down.get() * (1 - dim), transform: [{ scale: 1 - down.get() * (1 - scale) }] }));
  return (
    <APressable
      {...p}
      disabled={disabled}
      onPressIn={(e) => {
        down.set(withTiming(1, { duration: motion.press }));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        down.set(withTiming(0, { duration: motion.press }));
        onPressOut?.(e);
      }}
      style={[style, !disabled && sink]}
    />
  );
}

export type SurfaceProps = ViewProps & { variant?: 'card' | 'raised' | 'muted' };

/** A surface's fill, border and corners, for a pressable that is itself the card. */
export const surfaceStyle = (color: Palette, variant: NonNullable<SurfaceProps['variant']> = 'card'): ViewStyle => ({
  backgroundColor: variant === 'muted' ? color.muted : variant === 'raised' ? color.raised : color.card,
  borderRadius: radius.card,
  borderCurve: 'continuous',
  borderWidth: variant === 'muted' ? 0 : 1,
  borderColor: color.line,
});

export function Surface({ variant = 'card', style, ...p }: SurfaceProps) {
  const { color } = useTheme();
  return <View {...p} style={[surfaceStyle(color, variant), style]} />;
}

/** A state dot; `live` breathes while something is running. */
export function StatusDot({ color, live, size = 6 }: { color: string; live?: boolean; size?: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    if (live) t.set(withRepeat(withTiming(1, { duration: motion.pulse, easing: Easing.inOut(Easing.ease) }), -1, true));
    else {
      cancelAnimation(t);
      t.set(0);
    }
  }, [live, t]);
  const breathe = useAnimatedStyle(() => ({ opacity: 1 - t.get() * 0.65, transform: [{ scale: 1 - t.get() * 0.2 }] }));
  return <Animated.View accessibilityLabel={live ? 'Working' : undefined} style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }, breathe]} />;
}
