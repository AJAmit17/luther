import { useEffect } from 'react';
import { Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { ToggleProps } from './toggle';
import { tint, useTheme } from './theme';
import { motion, shadow } from './tokens';

export type { ToggleProps };

/** iOS's switch, drawn: 51×31, a white knob, the track filling with heat. */
export function Toggle({ value, onValueChange, disabled, label }: ToggleProps) {
  const { color } = useTheme();
  const on = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    on.set(withTiming(value ? 1 : 0, { duration: motion.state }));
  }, [value, on]);
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: on.get() * 20 }] }));
  const fill = useAnimatedStyle(() => ({ opacity: on.get() }));
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={() => {
        void Haptics.selectionAsync();
        onValueChange(!value);
      }}
      style={{ width: 51, height: 31, borderRadius: 16, backgroundColor: tint(color.text, 0.16), opacity: disabled ? 0.5 : 1 }}
    >
      <Animated.View style={[{ position: 'absolute', inset: 0, borderRadius: 16, backgroundColor: color.accent }, fill]} />
      <Animated.View style={[{ position: 'absolute', top: 2, left: 2, width: 27, height: 27, borderRadius: 14, backgroundColor: '#FFFFFF', boxShadow: shadow.knob }, knob]} />
    </Pressable>
  );
}
